"""Auto-censor: mute profanity in the audio and star it in the captions.

This is only possible because the pipeline keeps word-level timings -- we know
to the centisecond when the word starts and ends, so the mute is surgical: the
sentence stays intact and only the word itself drops out. Platforms demonetise
or age-restrict on audible profanity, so for a creator this is the difference
between a clip they can post and one they have to re-edit by hand.

Matching is deliberately conservative: an exact-stem match against a fixed
list. A false positive silences a legitimate word mid-sentence, which is far
worse than letting a borderline word through.
"""

import re

# Core English stems, matched as prefixes (covers -ing, -er, -ed) but only on
# whole transcript words. Mild words (damn, hell, crap) are left alone -- muting
# those makes clips feel censored rather than clean.
_STEMS = (
    "fuck", "shit", "bitch", "asshole", "cunt", "dickhead",
    "motherfuck", "bullshit", "pussy", "cocksuck", "wanker",
)

# Common Hindi/Hinglish profanity as it appears in transcripts.
_EXACT = {
    "chutiya", "chutiye", "bhosdike", "bhosdika", "madarchod", "behenchod",
    "bhenchod", "gandu", "gaand", "lauda", "lawda", "randi", "harami",
    "cutiya", "cuutiya", "lund","laudaa","lundke"
}

_CLEAN = re.compile(r"[^a-zऀ-ॿ]+")   # keep latin + Devanagari


def _norm(text: str) -> str:
    return _CLEAN.sub("", (text or "").lower())


def is_profane(word_text: str) -> bool:
    norm = _norm(word_text)
    if not norm:
        return False
    if norm in _EXACT:
        return True
    return any(norm.startswith(stem) for stem in _STEMS)


def mask(text: str) -> str:
    """f**k-style mask: first and last characters kept, middle starred.

    Trailing punctuation survives so the sentence still reads naturally.
    """
    match = re.match(r"^(\W*)(\w+)(\W*)$", text or "", re.UNICODE)
    if not match:
        return "***"
    pre, core, post = match.groups()
    if len(core) <= 2:
        starred = core[0] + "*" * (len(core) - 1)
    else:
        starred = core[0] + "*" * (len(core) - 2) + core[-1]
    return pre + starred + post


# Muting exactly the word boundary clips the consonant of the next word; a
# small pad sounds cleaner than a perfectly-timed cut.
PAD = 0.04


def apply(words: list, offset: float) -> tuple:
    """(masked_words, mute_spans) for a clip.

    `offset` converts source-time words to the rendered clip's timeline (the
    clip start normally, 0.0 when pause-tightening already remapped them).
    Words are copied, not mutated -- the stored transcript stays uncensored so
    the editor still shows what was really said.
    """
    masked = []
    spans = []
    for w in words:
        if is_profane(w.get("punctuated_word") or w.get("word") or ""):
            w = {**w, "punctuated_word": mask(w.get("punctuated_word") or w.get("word", ""))}
            spans.append((max(0.0, w["start"] - offset - PAD), w["end"] - offset + PAD))
        masked.append(w)
    return masked, spans
