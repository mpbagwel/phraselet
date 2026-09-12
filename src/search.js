export function rankCards(cards, {
  query = "",
  tag = "",
  status = "",
  includeEnrichment = false
} = {}) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenize(normalizedQuery);
  const normalizedTag = normalizeSearchText(tag);

  return cards
    .map((card, index) => ({ card, index, score: scoreCard(card, normalizedQuery, queryTokens, includeEnrichment) }))
    .filter(({ card, score }) => {
      const matchesStatus = !status || card.status === status;
      const matchesTag = !normalizedTag || (card.tags || [])
        .some((candidate) => normalizeSearchText(candidate) === normalizedTag);
      return matchesStatus && matchesTag && score !== null;
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ card }) => card);
}

function scoreCard(card, query, queryTokens, includeEnrichment) {
  if (!query) {
    return 0;
  }

  const phrase = normalizeSearchText(card.selectedText);
  const fields = [
    { text: phrase, weight: 8 },
    { text: normalizeSearchText((card.tags || []).join(" ")), weight: 6 },
    { text: normalizeSearchText(card.note), weight: 5 },
    { text: normalizeSearchText(card.sourceTitle), weight: 3 },
    { text: normalizeSearchText(card.contextText), weight: 2 }
  ];

  if (includeEnrichment) {
    fields.push({
      text: normalizeSearchText([card.ai?.summary, card.ai?.contextMeaning].join(" ")),
      weight: 2
    });
  }

  if (phrase === query) {
    return 10000;
  }
  if (phrase.startsWith(query)) {
    return 8000 - phrase.length;
  }

  const fullMatch = fields.find(({ text }) => text.includes(query));
  if (fullMatch) {
    return 5000 + fullMatch.weight * 100 - fullMatch.text.indexOf(query);
  }

  let total = 0;
  for (const queryToken of queryTokens) {
    let bestTokenScore = 0;
    fields.forEach(({ text, weight }) => {
      tokenize(text).forEach((candidate) => {
        bestTokenScore = Math.max(bestTokenScore, tokenScore(queryToken, candidate) * weight);
      });
    });

    if (!bestTokenScore) {
      return null;
    }
    total += bestTokenScore;
  }

  return total;
}

function tokenScore(query, candidate) {
  if (candidate === query) {
    return 100;
  }
  if (candidate.startsWith(query)) {
    return 80;
  }
  if (candidate.includes(query)) {
    return 60;
  }

  const threshold = query.length >= 7 ? 2 : query.length >= 4 ? 1 : 0;
  if (!threshold || Math.abs(candidate.length - query.length) > threshold) {
    return 0;
  }

  const distance = editDistanceWithin(query, candidate, threshold);
  return distance <= threshold ? 45 - distance * 10 : 0;
}

function editDistanceWithin(left, right, limit) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = current[0];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]
        + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        substitution
      );
      rowMinimum = Math.min(rowMinimum, current[rightIndex]);
    }

    if (rowMinimum > limit) {
      return limit + 1;
    }
    previous = current;
  }

  return previous[right.length];
}

function tokenize(value) {
  return value.match(/[\p{L}\p{N}]+/gu) || [];
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .trim();
}
