import os, json, time
import flask
import redis

app = flask.Flask(__name__)

def get_redis():
    url = os.environ.get("REDIS_URL", "redis://kv-cache-01:6379/0")
    return redis.Redis.from_url(url, socket_connect_timeout=2)

@app.route("/status")
def status():
    checks = {}

    # Redis connectivity
    try:
        r = get_redis()
        r.ping()
        checks["redis"] = "ok"
    except Exception as e:
        checks["redis"] = str(e)

    # Spool directory write test
    try:
        test_path = "/app/spool/heartbeat.tmp"
        with open(test_path, "w") as f:
            f.write(str(time.time()))
        os.remove(test_path)
        checks["spool"] = "ok"
    except Exception as e:
        checks["spool"] = str(e)

    all_ok = all(v == "ok" for v in checks.values())
    checks["status"] = "ok" if all_ok else "degraded"
    code = 200 if all_ok else 503
    return flask.jsonify(checks), code

if __name__ == "__main__":
    print("worker starting on :8080", flush=True)
    app.run(host="0.0.0.0", port=8080)
