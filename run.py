import uvicorn
import sys

def main():
    port = 8000
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except ValueError:
            pass
    print(f"Starting CardSense India Dashboard on http://localhost:{port}")
    uvicorn.run("src.api:app", host="127.0.0.1", port=port, reload=True)

if __name__ == "__main__":
    main()
