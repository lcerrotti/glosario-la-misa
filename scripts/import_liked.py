import json
import os
import re
import sys
import unicodedata
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent.parent
TERMS_PATH = ROOT / "terms.json"
IMPORTED_PATH = ROOT / "data" / "imported-ids.json"


def fold(value: str) -> str:
    text = unicodedata.normalize("NFD", value.lower())
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", text).strip()


def clean_tweet_text(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text or "")
    text = re.sub(r"^(\s*@\w+\s*)+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def format_term(term: str) -> str:
    return re.sub(r"\s+", " ", term).strip().upper()


def format_definition(definition: str) -> str:
    text = re.sub(r"\s+", " ", definition).strip()
    if not text:
        return ""
    return text[0].upper() + text[1:].lower()


def parse_entry(text: str):
    cleaned = clean_tweet_text(text)
    cut = cleaned.find(":")
    if cut < 1:
        return None
    term = format_term(cleaned[:cut])
    definition = format_definition(cleaned[cut + 1 :])
    if not term or not definition:
        return None
    if len(term) > 48 or len(definition) > 400:
        return None
    return {"term": term, "aliases": [], "definition": definition}


def read_terms():
    return json.loads(TERMS_PATH.read_text(encoding="utf-8"))


def load_imported() -> list[str]:
    if not IMPORTED_PATH.exists():
        return []
    return json.loads(IMPORTED_PATH.read_text(encoding="utf-8"))


def fetch_liked_tweets(token: str, user_id: str, conversation_id: str):
    tweets = []
    params = {
        "max_results": "100",
        "tweet.fields": "conversation_id,text",
    }
    for _ in range(5):
        url = f"https://api.x.com/2/users/{user_id}/liked_tweets?{urlencode(params)}"
        req = Request(url, headers={"Authorization": f"Bearer {token}"})
        with urlopen(req) as response:
            payload = json.loads(response.read().decode("utf-8"))
        for tweet in payload.get("data") or []:
            if tweet.get("conversation_id") == conversation_id and tweet.get("id") != conversation_id:
                tweets.append(tweet)
        next_token = (payload.get("meta") or {}).get("next_token")
        if not next_token:
            break
        params["pagination_token"] = next_token
    return tweets


def merge_entries(terms, imported_ids, tweets):
    known_ids = set(imported_ids)
    known_terms = {fold(item["term"]) for item in terms}
    added = []
    skipped = []

    for tweet in tweets:
        tweet_id = tweet["id"]
        if tweet_id in known_ids:
            skipped.append({"id": tweet_id, "reason": "ya importado"})
            continue

        entry = parse_entry(tweet.get("text", ""))
        known_ids.add(tweet_id)

        if not entry:
            skipped.append({"id": tweet_id, "reason": "formato inválido"})
            continue

        if fold(entry["term"]) in known_terms:
            skipped.append({"id": tweet_id, "term": entry["term"], "reason": "duplicado"})
            continue

        terms.append(entry)
        known_terms.add(fold(entry["term"]))
        added.append({"id": tweet_id, "term": entry["term"]})

    terms.sort(key=lambda item: fold(item["term"]))
    return terms, list(known_ids), added, skipped


def main():
    fixture = os.environ.get("LIKED_FIXTURE")
    token = os.environ.get("X_BEARER_TOKEN")
    user_id = os.environ.get("X_USER_ID")
    conversation_id = os.environ.get("X_CONVERSATION_ID")

    if fixture:
        raw = json.loads(Path(fixture).read_text(encoding="utf-8"))
        tweets = raw.get("data", raw)
    else:
        if not token or not user_id or not conversation_id:
            raise SystemExit(
                "Faltan X_BEARER_TOKEN, X_USER_ID y X_CONVERSATION_ID, o LIKED_FIXTURE para una prueba."
            )
        tweets = fetch_liked_tweets(token, user_id, conversation_id)

    terms = read_terms()
    imported_ids = load_imported()
    terms, imported_ids, added, skipped = merge_entries(terms, imported_ids, tweets)

    IMPORTED_PATH.parent.mkdir(parents=True, exist_ok=True)
    IMPORTED_PATH.write_text(json.dumps(imported_ids, indent=2) + "\n", encoding="utf-8")
    TERMS_PATH.write_text(json.dumps(terms, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"Agregados: {len(added)}")
    for item in added:
        print(f"  + {item['term']}")
    print(f"Salteados: {len(skipped)}")
    for item in skipped:
        print(f"  - {item['id']} ({item['reason']})")


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        sample = parse_entry("@lcerrottii kuka:kirchnerista o peronista K")
        assert sample == {
            "term": "KUKA",
            "aliases": [],
            "definition": "Kirchnerista o peronista k",
        }, sample
        sample = parse_entry("VERDADERO:EL QUE LA VE Y NO SE VENDE")
        assert sample["term"] == "VERDADERO"
        assert sample["definition"] == "El que la ve y no se vende"
        assert parse_entry("esto no tiene formato") is None
        print("ok")
    else:
        main()
