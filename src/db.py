import sqlite3
import json
import secrets
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple

from src.models import CreditCard, SpendProfile, PerkWeights

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "cc_analysis.db"
CARDS_JSON_PATH = Path(__file__).resolve().parent.parent / "data" / "cards.json"


def get_db_connection(db_path: Optional[Path] = None) -> sqlite3.Connection:
    path = db_path or DEFAULT_DB_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db(db_path: Optional[Path] = None) -> None:
    conn = get_db_connection(db_path)
    with conn:
        # 1. Users table (Google OAuth only)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                google_id TEXT UNIQUE NOT NULL,
                email TEXT UNIQUE NOT NULL COLLATE NOCASE,
                full_name TEXT,
                avatar_url TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 2. Sessions table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 3. Cards table (backed by SQLite)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                bank TEXT NOT NULL,
                network TEXT DEFAULT 'Visa',
                tier TEXT DEFAULT 'Mid',
                annual_fee REAL DEFAULT 0.0,
                gst_rate REAL DEFAULT 0.18,
                fee_waiver_spend_annual REAL,
                joining_fee REAL DEFAULT 0.0,
                is_ltf INTEGER DEFAULT 0,
                reward_type TEXT DEFAULT 'cashback',
                point_value_inr REAL DEFAULT 1.0,
                base_reward_rate REAL DEFAULT 0.01,
                category_rates TEXT DEFAULT '{}',
                category_caps_monthly TEXT DEFAULT '{}',
                category_exclusions TEXT DEFAULT '[]',
                overall_monthly_reward_cap REAL,
                milestones TEXT DEFAULT '[]',
                perks TEXT DEFAULT '{}',
                rupay_upi_enabled INTEGER DEFAULT 0,
                key_highlights TEXT DEFAULT '[]',
                source_url TEXT,
                is_custom INTEGER DEFAULT 0,
                created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 4. User Selected Cards (Portfolio)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_portfolios (
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
                order_index INTEGER DEFAULT 0,
                is_active INTEGER DEFAULT 1,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, card_id)
            )
        """)

        # 5. User Monthly Spend Profile
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_spend_profiles (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                monthly_spend TEXT NOT NULL DEFAULT '{}',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # 6. User Perk Weights & Custom Valuations
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_perk_weights (
                user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                weights TEXT NOT NULL DEFAULT '{}',
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)

    # Seed cards if empty
    seed_cards_from_json(conn)

    # Seed default demo Google user if not exists
    seed_demo_google_user(conn)

    conn.close()


def seed_cards_from_json(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("SELECT COUNT(*) as cnt FROM cards")
    row = cursor.fetchone()
    if row and row["cnt"] > 0:
        return

    if not CARDS_JSON_PATH.exists():
        return

    with open(CARDS_JSON_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
        cards = data.get("cards", [])

    with conn:
        for c in cards:
            conn.execute("""
                INSERT OR REPLACE INTO cards (
                    id, name, bank, network, tier, annual_fee, gst_rate,
                    fee_waiver_spend_annual, joining_fee, is_ltf, reward_type,
                    point_value_inr, base_reward_rate, category_rates,
                    category_caps_monthly, category_exclusions, overall_monthly_reward_cap,
                    milestones, perks, rupay_upi_enabled, key_highlights, source_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                c["id"],
                c["name"],
                c["bank"],
                c.get("network", "Visa"),
                c.get("tier", "Mid"),
                c.get("annual_fee", 0.0),
                c.get("gst_rate", 0.18),
                c.get("fee_waiver_spend_annual"),
                c.get("joining_fee", 0.0),
                1 if c.get("is_ltf", False) else 0,
                c.get("reward_type", "cashback"),
                c.get("point_value_inr", 1.0),
                c.get("base_reward_rate", 0.01),
                json.dumps(c.get("category_rates", {})),
                json.dumps(c.get("category_caps_monthly", {})),
                json.dumps(c.get("category_exclusions", [])),
                c.get("overall_monthly_reward_cap"),
                json.dumps(c.get("milestones", [])),
                json.dumps(c.get("perks", {})),
                1 if c.get("rupay_upi_enabled", False) else 0,
                json.dumps(c.get("key_highlights", [])),
                c.get("source_url")
            ))


def seed_demo_google_user(conn: sqlite3.Connection) -> None:
    cursor = conn.execute("SELECT id FROM users WHERE google_id = 'google_demo_101'")
    if cursor.fetchone():
        return

    with conn:
        conn.execute("""
            INSERT INTO users (google_id, email, full_name, avatar_url)
            VALUES (?, ?, ?, ?)
        """, (
            "google_demo_101",
            "demo.user@gmail.com",
            "Demo Google User",
            "https://lh3.googleusercontent.com/a/default-user"
        ))

        cursor = conn.execute("SELECT id FROM users WHERE google_id = 'google_demo_101'")
        user_id = cursor.fetchone()["id"]

        # Default portfolio: SBI Cashback, Amazon Pay ICICI, Airtel Axis
        for idx, cid in enumerate(["sbi_cashback", "icici_amazon_pay", "axis_airtel"]):
            conn.execute(
                "INSERT OR IGNORE INTO user_portfolios (user_id, card_id, order_index) VALUES (?, ?, ?)",
                (user_id, cid, idx)
            )

        # Default spend profile
        default_spend = {
            "dining_food_delivery": 6000,
            "groceries": 9000,
            "online_shopping": 12000,
            "utilities_bills": 4000,
            "travel_flights_hotels": 7000,
            "fuel": 4000,
            "movies_entertainment": 2000,
            "general_offline": 6000
        }
        conn.execute("""
            INSERT OR REPLACE INTO user_spend_profiles (user_id, monthly_spend)
            VALUES (?, ?)
        """, (user_id, json.dumps(default_spend)))

        # Default weights
        conn.execute("""
            INSERT OR REPLACE INTO user_perk_weights (user_id, weights)
            VALUES (?, ?)
        """, (user_id, json.dumps(PerkWeights().model_dump())))


# --- Google Auth CRUD ---

def get_or_create_google_user(
    google_id: str,
    email: str,
    full_name: Optional[str] = None,
    avatar_url: Optional[str] = None,
    db_path: Optional[Path] = None
) -> Dict[str, Any]:
    conn = get_db_connection(db_path)
    try:
        cursor = conn.execute("SELECT * FROM users WHERE google_id = ? OR email = ?", (google_id, email.lower()))
        row = cursor.fetchone()

        if row:
            # Update latest full_name and avatar_url if provided
            user_id = row["id"]
            with conn:
                conn.execute("""
                    UPDATE users
                    SET google_id = ?, full_name = COALESCE(?, full_name), avatar_url = COALESCE(?, avatar_url)
                    WHERE id = ?
                """, (google_id, full_name, avatar_url, user_id))

            cursor = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            return dict(cursor.fetchone())

        # Create new user
        with conn:
            cursor = conn.execute("""
                INSERT INTO users (google_id, email, full_name, avatar_url)
                VALUES (?, ?, ?, ?)
            """, (google_id, email.lower().strip(), full_name, avatar_url))
            user_id = cursor.lastrowid

            # Initialize with default starter portfolio
            for idx, cid in enumerate(["sbi_cashback", "icici_amazon_pay", "axis_airtel"]):
                conn.execute(
                    "INSERT INTO user_portfolios (user_id, card_id, order_index, is_active) VALUES (?, ?, ?, 1)",
                    (user_id, cid, idx)
                )

            default_spend = {
                "dining_food_delivery": 5000,
                "groceries": 8000,
                "online_shopping": 10000,
                "utilities_bills": 4000,
                "travel_flights_hotels": 7000,
                "fuel": 4000,
                "movies_entertainment": 1500,
                "general_offline": 10000
            }
            conn.execute("INSERT INTO user_spend_profiles (user_id, monthly_spend) VALUES (?, ?)", (user_id, json.dumps(default_spend)))
            conn.execute("INSERT INTO user_perk_weights (user_id, weights) VALUES (?, ?)", (user_id, json.dumps(PerkWeights().model_dump())))

        cursor = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        return dict(cursor.fetchone())
    finally:
        conn.close()


def create_session(user_id: int, db_path: Optional[Path] = None) -> str:
    conn = get_db_connection(db_path)
    token = secrets.token_urlsafe(32)
    try:
        with conn:
            conn.execute("INSERT INTO sessions (token, user_id) VALUES (?, ?)", (token, user_id))
        return token
    finally:
        conn.close()


def get_user_by_token(token: str, db_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    conn = get_db_connection(db_path)
    try:
        cursor = conn.execute("""
            SELECT u.id, u.google_id, u.email, u.full_name, u.avatar_url, u.created_at
            FROM sessions s
            JOIN users u ON s.user_id = u.id
            WHERE s.token = ?
        """, (token,))
        row = cursor.fetchone()
        if not row:
            return None
        return dict(row)
    finally:
        conn.close()


def delete_session(token: str, db_path: Optional[Path] = None) -> bool:
    conn = get_db_connection(db_path)
    try:
        with conn:
            cursor = conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
            return cursor.rowcount > 0
    finally:
        conn.close()


# --- User Config Get & Update ---

def get_user_config(user_id: int, db_path: Optional[Path] = None) -> Dict[str, Any]:
    conn = get_db_connection(db_path)
    try:
        # Selected cards ordered by user selection order
        cursor = conn.execute("""
            SELECT card_id FROM user_portfolios
            WHERE user_id = ? AND is_active = 1
            ORDER BY order_index ASC, rowid ASC
        """, (user_id,))
        card_ids = [r["card_id"] for r in cursor.fetchall()]

        # Spend profile
        cursor = conn.execute("SELECT monthly_spend FROM user_spend_profiles WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        spend = json.loads(row["monthly_spend"]) if row else {}

        # Perk weights
        cursor = conn.execute("SELECT weights FROM user_perk_weights WHERE user_id = ?", (user_id,))
        row = cursor.fetchone()
        weights = json.loads(row["weights"]) if row else PerkWeights().model_dump()

        return {
            "user_id": user_id,
            "selected_card_ids": card_ids,
            "spend_profile": {"monthly_spend": spend},
            "weights": weights
        }
    finally:
        conn.close()


def save_user_config(
    user_id: int,
    selected_card_ids: List[str],
    spend_profile: Dict[str, float],
    weights: Dict[str, Any],
    db_path: Optional[Path] = None
) -> Dict[str, Any]:
    conn = get_db_connection(db_path)
    try:
        with conn:
            # Update portfolio cards
            conn.execute("DELETE FROM user_portfolios WHERE user_id = ?", (user_id,))
            for idx, cid in enumerate(selected_card_ids):
                conn.execute(
                    "INSERT INTO user_portfolios (user_id, card_id, order_index, is_active) VALUES (?, ?, ?, 1)",
                    (user_id, cid, idx)
                )

            # Update spend profile
            conn.execute("""
                INSERT OR REPLACE INTO user_spend_profiles (user_id, monthly_spend, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (user_id, json.dumps(spend_profile)))

            # Update weights
            conn.execute("""
                INSERT OR REPLACE INTO user_perk_weights (user_id, weights, updated_at)
                VALUES (?, ?, CURRENT_TIMESTAMP)
            """, (user_id, json.dumps(weights)))

        return get_user_config(user_id, db_path)
    finally:
        conn.close()


# --- Database Cards Catalog Query ---

def get_all_cards_from_db(db_path: Optional[Path] = None) -> List[CreditCard]:
    conn = get_db_connection(db_path)
    try:
        cursor = conn.execute("SELECT * FROM cards ORDER BY bank, name")
        cards = []
        for r in cursor.fetchall():
            cards.append(CreditCard(
                id=r["id"],
                name=r["name"],
                bank=r["bank"],
                network=r["network"],
                tier=r["tier"],
                annual_fee=r["annual_fee"],
                gst_rate=r["gst_rate"],
                fee_waiver_spend_annual=r["fee_waiver_spend_annual"],
                joining_fee=r["joining_fee"],
                is_ltf=bool(r["is_ltf"]),
                reward_type=r["reward_type"],
                point_value_inr=r["point_value_inr"],
                base_reward_rate=r["base_reward_rate"],
                category_rates=json.loads(r["category_rates"] or "{}"),
                category_caps_monthly=json.loads(r["category_caps_monthly"] or "{}"),
                category_exclusions=json.loads(r["category_exclusions"] or "[]"),
                overall_monthly_reward_cap=r["overall_monthly_reward_cap"],
                milestones=json.loads(r["milestones"] or "[]"),
                perks=json.loads(r["perks"] or "{}"),
                rupay_upi_enabled=bool(r["rupay_upi_enabled"]),
                key_highlights=json.loads(r["key_highlights"] or "[]"),
                source_url=r["source_url"]
            ))
        return cards
    finally:
        conn.close()


def save_card_to_db(card: CreditCard, user_id: Optional[int] = None, is_custom: bool = False, db_path: Optional[Path] = None) -> None:
    conn = get_db_connection(db_path)
    try:
        with conn:
            conn.execute("""
                INSERT OR REPLACE INTO cards (
                    id, name, bank, network, tier, annual_fee, gst_rate,
                    fee_waiver_spend_annual, joining_fee, is_ltf, reward_type,
                    point_value_inr, base_reward_rate, category_rates,
                    category_caps_monthly, category_exclusions, overall_monthly_reward_cap,
                    milestones, perks, rupay_upi_enabled, key_highlights, source_url,
                    is_custom, created_by_user_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                card.id,
                card.name,
                card.bank,
                card.network,
                card.tier,
                card.annual_fee,
                card.gst_rate,
                card.fee_waiver_spend_annual,
                card.joining_fee,
                1 if card.is_ltf else 0,
                card.reward_type,
                card.point_value_inr,
                card.base_reward_rate,
                json.dumps(card.category_rates),
                json.dumps(card.category_caps_monthly),
                json.dumps(card.category_exclusions),
                card.overall_monthly_reward_cap,
                json.dumps([m.model_dump() for m in card.milestones]),
                json.dumps(card.perks.model_dump()),
                1 if card.rupay_upi_enabled else 0,
                json.dumps(card.key_highlights),
                card.source_url,
                1 if is_custom else 0,
                user_id
            ))
    finally:
        conn.close()
