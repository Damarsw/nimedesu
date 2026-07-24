from flask import Flask, jsonify
from flask_cors import CORS
import json
import os

app = Flask(__name__)
CORS(app)

DB_ANIME_FINAL = "otakudesu_infozingle.json"
DB_EPISODE_BARU = "data_anime_sinopsis.json"
DB_SUPER_LENGKAP = "data_anime_super_lengkap.json"

def load_json(filename):
    if not os.path.exists(filename):
        return []
    with open(filename, "r", encoding="utf-8") as f:
        try:
            return json.load(f)
        except json.JSONDecodeError:
            return []

@app.route("/")
def home():
    return "NimeDesu API Server is Active!"

@app.route("/api/anime", methods=["GET"])
def api_anime():
    return jsonify(load_json(DB_ANIME_FINAL))

@app.route("/api/sinopsis", methods=["GET"])
def api_sinopsis():
    return jsonify(load_json(DB_EPISODE_BARU))

@app.route("/api/super-lengkap", methods=["GET"])
def api_super_lengkap():
    return jsonify(load_json(DB_SUPER_LENGKAP))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 10000))
    app.run(host="0.0.0.0", port=port)