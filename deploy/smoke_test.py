"""Smoke test + tiny retrieval sanity check for a llama.cpp embedding server."""
import json
import os
import statistics
import sys
import time
import urllib.request

try:  # Windows 控制台默认 GBK，中文排序结果会乱码
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # noqa: BLE001
    pass

PORT = os.environ.get("EMBED_PORT", "8080")

if len(sys.argv) > 1:
    PORT = sys.argv[1]
URL = f"http://127.0.0.1:{PORT}/v1/embeddings"
MODEL = "embeddinggemma2"



def embed(texts, timeout=120):
    body = json.dumps(
        {"model": MODEL, "input": texts, "encoding_format": "float"}
    ).encode()
    req = urllib.request.Request(
        URL, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


CORPUS = [
    "在登录页点击“忘记密码”，系统会向注册邮箱发送重置链接。",
    "账单地址可以在账户设置的付款方式里修改。",
    "开启两步验证（2FA）可以显著降低账号被盗风险。",
    "The embedding service must be reached over the internal network only.",
    "def reset_password(user): return user.send_reset_mail()",
]


def main():
    q = "task: search result | query: 怎么重置我的账号密码？"
    docs = [f"title: none | text: {d}" for d in CORPUS]

    t0 = time.time()
    r = embed([q] + docs)
    first = (time.time() - t0) * 1000
    vecs = [d["embedding"] for d in r["data"]]
    assert all(len(v) == 768 for v in vecs), "unexpected dimension"
    assert all(abs(sum(x * x for x in v) ** 0.5 - 1) < 1e-3 for v in vecs), "not L2-normalized"

    # warm latency
    lat = []
    for _ in range(10):
        t = time.time()
        embed([q])
        lat.append((time.time() - t) * 1000)

    scores = sorted(
        ((sum(a * b for a, b in zip(vecs[0], v)), i) for i, v in enumerate(vecs[1:])),
        reverse=True,
    )
    print(f"cold(6 inputs): {first:.0f} ms | warm(query only): "
          f"median {statistics.median(lat):.0f} ms, p90 {sorted(lat)[8]:.0f} ms")
    print(f"dim={len(vecs[0])}  finite={all(x == x for v in vecs for x in v)}")
    print("ranking:")
    for s, i in scores:
        print(f"  {s:.4f}  {CORPUS[i][:52]}")


if __name__ == "__main__":
    main()
