import os, sys, time, json
import flask
import psycopg2
import redis
import requests

app = flask.Flask(__name__)

_leak = []

def get_db():
    url = os.environ["DATABASE_URL"]
    conn = psycopg2.connect(url)
    conn.autocommit = True
    return conn

def get_redis():
    url = os.environ["REDIS_URL"]
    return redis.Redis.from_url(url, socket_connect_timeout=2)

@app.route("/")
def index():
    results = {}

    # DB check
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT 1")
        results["db"] = "ok"
        cur.close()
        conn.close()
    except Exception as e:
        results["db"] = str(e)

    # Redis check
    try:
        r = get_redis()
        r.ping()
        results["cache"] = "ok"
    except Exception as e:
        results["cache"] = str(e)

    # Worker check
    try:
        wurl = os.environ.get("WORKER_URL", "http://172.31.0.40:8080")
        resp = requests.get(wurl + "/status", timeout=3)
        results["worker"] = resp.json()
    except Exception as e:
        results["worker"] = str(e)

    # Memory pressure - leak ~2MB per request
    _leak.append(b"X" * 2 * 1024 * 1024)

    all_ok = (results.get("db") == "ok"
              and results.get("cache") == "ok"
              and isinstance(results.get("worker"), dict)
              and results["worker"].get("status") == "ok")

    code = 200 if all_ok else 503
    return flask.jsonify(results), code

@app.route("/healthz")
def healthz():
    return "ok", 200

if __name__ == "__main__":
    print("appserver starting on :5000", flush=True)
    app.run(host="0.0.0.0", port=5000)
