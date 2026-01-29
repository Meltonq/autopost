const STOP_WORDS = new Set([
  "это",
  "как",
  "что",
  "чтобы",
  "когда",
  "тогда",
  "есть",
  "еще",
  "ещё",
  "вот",
  "тут",
  "там",
  "про",
  "при",
  "для",
  "без",
  "или",
  "она",
  "оно",
  "они",
  "ты",
  "вы",
  "мы",
  "он",
  "тот",
  "эта",
  "эти",
  "your",
  "the",
  "and",
  "with",
  "from",
]);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toWordSet(text) {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
  );
}

function toBigramSet(text) {
  const words = normalize(text)
    .split(" ")
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  const bigrams = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }
  return new Set(bigrams);
}

function jaccard(setA, setB) {
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter += 1;
  return inter / (setA.size + setB.size - inter || 1);
}

export function similarity(a, b) {
  const wordScore = jaccard(toWordSet(a), toWordSet(b));
  const bigramScore = jaccard(toBigramSet(a), toBigramSet(b));
  return wordScore * 0.6 + bigramScore * 0.4;
}
