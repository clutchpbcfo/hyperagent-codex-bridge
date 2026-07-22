import json
import sys

from openai import OpenAI


if len(sys.argv) != 3:
    raise SystemExit("Usage: openai_python_client.py <base-url> <api-key>")

client = OpenAI(base_url=sys.argv[1], api_key=sys.argv[2], max_retries=0)
response = client.responses.create(
    model="hyperagent/sol-coder",
    input="Mocked Python client fixture.",
    stream=False,
    extra_headers={"Idempotency-Key": "openai-python-fixture"},
)
print(json.dumps({
    "id": response.id,
    "text": response.output_text,
    "request_id": (response.metadata or {}).get("request_id"),
    "usage": response.usage.model_dump() if response.usage else None,
}))
