import { embed, cosineSimilarity } from './embeddings.js';

/**
 * Split text into sentence boundaries.
 */
function splitSentences(text) {
  // Split on sentence-ending punctuation followed by whitespace and uppercase
  // Also treat newlines as boundaries
  const raw = text.split(/(?<=[.!?])\s+(?=[A-Z])|\n+/).filter(s => s.trim());
  return raw.map(s => s.trim()).filter(Boolean);
}

/**
 * 1. Fixed-size chunking with overlap.
 */
export function chunkFixed(text, { chunkSize = 512, overlap = 50 } = {}) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push({
      text: text.slice(start, end),
      metadata: { strategy: 'fixed', index: chunks.length, charStart: start, charEnd: end },
    });
    start += chunkSize - overlap;
    if (start >= text.length) break;
  }
  return chunks;
}

/**
 * 2. Sentence-based chunking.
 */
export function chunkSentence(text, { maxChunkSentences = 3 } = {}) {
  const sentences = splitSentences(text);
  const chunks = [];
  for (let i = 0; i < sentences.length; i += maxChunkSentences) {
    const group = sentences.slice(i, i + maxChunkSentences);
    chunks.push({
      text: group.join(' '),
      metadata: { strategy: 'sentence', index: chunks.length, sentenceStart: i, sentenceEnd: i + group.length },
    });
  }
  return chunks;
}

/**
 * 3. Paragraph-based chunking.
 */
export function chunkParagraph(text, { minParagraphLength = 50 } = {}) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current && (current.length + para.length) > minParagraphLength * 10) {
      chunks.push({
        text: current,
        metadata: { strategy: 'paragraph', index: chunks.length },
      });
      current = para;
    } else if (current.length < minParagraphLength) {
      current = current ? `${current}\n\n${para}` : para;
    } else {
      if (current) {
        chunks.push({
          text: current,
          metadata: { strategy: 'paragraph', index: chunks.length },
        });
      }
      current = para;
    }
  }
  if (current) {
    chunks.push({
      text: current,
      metadata: { strategy: 'paragraph', index: chunks.length },
    });
  }
  return chunks;
}

/**
 * 4. Sliding window chunking.
 */
export function chunkSlidingWindow(text, { windowSize = 512, stepSize = 256 } = {}) {
  const chunks = [];
  for (let start = 0; start < text.length; start += stepSize) {
    const end = Math.min(start + windowSize, text.length);
    chunks.push({
      text: text.slice(start, end),
      metadata: { strategy: 'sliding', index: chunks.length, charStart: start, charEnd: end },
    });
    if (end >= text.length) break;
  }
  return chunks;
}

/**
 * 5. Semantic chunking — split where embedding similarity drops.
 */
export async function chunkSemantic(text, { threshold = 0.5 } = {}) {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) {
    return [{ text: text.trim(), metadata: { strategy: 'semantic', index: 0 } }];
  }

  // Embed each sentence
  const embeddings = [];
  for (const s of sentences) {
    embeddings.push(await embed(s));
  }

  // Find similarity breaks
  const chunks = [];
  let currentGroup = [sentences[0]];

  for (let i = 1; i < sentences.length; i++) {
    const sim = cosineSimilarity(embeddings[i - 1], embeddings[i]);
    if (sim < threshold) {
      // Similarity drop — start new chunk
      chunks.push({
        text: currentGroup.join(' '),
        metadata: { strategy: 'semantic', index: chunks.length, similarityBreak: sim },
      });
      currentGroup = [sentences[i]];
    } else {
      currentGroup.push(sentences[i]);
    }
  }
  if (currentGroup.length > 0) {
    chunks.push({
      text: currentGroup.join(' '),
      metadata: { strategy: 'semantic', index: chunks.length },
    });
  }
  return chunks;
}

/**
 * 6. Recursive/hierarchical chunking.
 */
export function chunkRecursive(text, { maxChunkSize = 1000 } = {}) {
  const chunks = [];

  // Split by markdown headers first
  const sections = text.split(/(?=^#{1,3}\s)/m);

  for (const section of sections) {
    const headingMatch = section.match(/^(#{1,3})\s+(.*)/);
    const heading = headingMatch ? headingMatch[2].trim() : null;
    const content = headingMatch ? section.slice(headingMatch[0].length).trim() : section.trim();

    if (!content) continue;

    if (content.length <= maxChunkSize) {
      chunks.push({
        text: heading ? `${heading}: ${content}` : content,
        metadata: { strategy: 'recursive', index: chunks.length, level: 'section', heading },
      });
    } else {
      // Split by paragraphs
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim());
      for (const para of paragraphs) {
        if (para.length <= maxChunkSize) {
          chunks.push({
            text: heading ? `${heading}: ${para.trim()}` : para.trim(),
            metadata: { strategy: 'recursive', index: chunks.length, level: 'paragraph', heading },
          });
        } else {
          // Split by sentences
          const sentences = splitSentences(para);
          let current = '';
          for (const sent of sentences) {
            if (current.length + sent.length > maxChunkSize && current) {
              chunks.push({
                text: heading ? `${heading}: ${current}` : current,
                metadata: { strategy: 'recursive', index: chunks.length, level: 'sentence', heading },
              });
              current = sent;
            } else {
              current = current ? `${current} ${sent}` : sent;
            }
          }
          if (current) {
            chunks.push({
              text: heading ? `${heading}: ${current}` : current,
              metadata: { strategy: 'recursive', index: chunks.length, level: 'sentence', heading },
            });
          }
        }
      }
    }
  }
  return chunks;
}

/**
 * Dispatcher — route to the appropriate strategy.
 * @param {string} text
 * @param {string} strategy
 * @param {object} options
 * @returns {Promise<Array<{text: string, metadata: object}>>}
 */
export async function chunk(text, strategy = 'paragraph', options = {}) {
  if (!text || !text.trim()) return [];

  switch (strategy) {
    case 'fixed': return chunkFixed(text, options);
    case 'sentence': return chunkSentence(text, options);
    case 'paragraph': return chunkParagraph(text, options);
    case 'sliding': return chunkSlidingWindow(text, options);
    case 'semantic': return chunkSemantic(text, options);
    case 'recursive': return chunkRecursive(text, options);
    default: return chunkParagraph(text, options);
  }
}
