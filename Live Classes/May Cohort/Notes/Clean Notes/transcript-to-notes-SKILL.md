---
name: transcript-to-notes
version: 1.0.0
description: |
  Convert YouTube transcripts, session transcripts, detailed lecture content,
  or verbose AI-generated summaries into concise, humanized study notes.
  Produces clean concept-first notes written as personal understanding,
  not transcript regurgitation. Use when the user provides a transcript
  or detailed content and wants distilled learnings from it.
---

# Transcript to Notes: distill transcripts into personal study notes

You are converting raw or detailed content into concise study notes. The output should read like notes a sharp student writes *after* understanding a session, not a summary of what was said.

## Core principle

**Extract the understanding, not the teaching.**

A teacher explains concepts using analogies, examples, repetition, tangents, and stories. None of that belongs in the notes. What belongs is the *concept itself* as the student now understands it.

Ask yourself for every line: "Is this the concept, or is this the explanation *of* the concept?" Only the concept goes in.

## What goes IN the notes

- Definitions and formulas (stated once, clearly)
- Core concepts distilled to their essence
- Practical rules, thresholds, and criteria
- Relationships between concepts (A leads to B, A and B together mean C)
- Checklists and decision frameworks
- Specific examples ONLY when they are the most efficient way to state a concept (e.g., "Titan Book Value: ₹131, CMP: ₹3,500" to show the gap between book and market)
- Actionable tips and things to remember in practice

## What stays OUT

- Analogies and metaphors used to explain concepts (the pizza analogy, the child growth analogy, etc.). The concept they were explaining goes in. The analogy itself does not.
- Step-by-step build-up that a teacher uses to arrive at a point. Just state the point.
- Repetition of the same idea in different words
- Commentary, opinions about other sources ("no matter what YouTube says"), emotional emphasis
- "Let me explain why" or "here's how to think about it" framing
- Verbose context-setting before making a point
- The teacher's personal anecdotes unless they contain a specific data point or fact

## Tone and language

- Write as if you are noting down what you *now know*, not what was *told to you*.
- **Wrong:** "Book Value across industries cannot be compared because capital-intensive businesses naturally have high book values while asset-light businesses have low ones, so you're measuring completely different things depending on the business."
- **Right:** "Book Value across industries cannot be compared. Capital-intensive businesses have inherently high book values, asset-light businesses have low ones. Different business models make the metric mean different things."
- Short, direct sentences. No filler. No "it is important to note" or "the key takeaway here is."
- Use the same domain terminology the source uses (don't simplify jargon that the reader already knows).

## Structure

1. **Group by concept**, not by chronological order of the transcript. If the teacher jumped between topics, reorganize by logical grouping.
2. **Use headers** for major concept areas.
3. **Use bullets and sub-bullets** for points under each concept. Keep bullets to 1-2 sentences max.
4. **Bold** for formulas, key terms, metric names, and critical rules.
5. **Italic** for caveats, exceptions, and "but not mandatory" type qualifiers.
6. **Separate "Practical tips to keep in mind"** into its own section at the end. These are platform-specific actions (e.g., toggle settings, tool behaviors, workflow reminders) that don't belong under concept sections.
7. **Checklists and frameworks** get their own section. If the source has a "what to check" or "when to buy/sell" framework, pull it out cleanly.
8. **No tables** unless comparing 3+ items across 3+ attributes. For simpler comparisons, use inline bullets.

## Humanizer rules (apply throughout)

These are non-negotiable for the final output:

- **No em dashes (—) or en dashes (–) anywhere.** Use commas, periods, colons, or parentheses instead.
- **No AI vocabulary:** don't use "crucial," "pivotal," "landscape," "delve," "foster," "underscore," "highlight," "showcase," "vibrant," "tapestry," "testament," "interplay," "intricate," "enhance."
- **No significance inflation:** don't say "this is a critical concept" or "this is perhaps the most important metric." Just state the concept.
- **No rule-of-three padding:** don't force ideas into groups of three for rhetorical effect.
- **No signposting:** don't say "let's look at" or "here's what you need to know" or "let's break this down."
- **No sycophantic framing:** don't say "great question" or "this is an excellent point."
- **No generic conclusions:** don't end with "these notes should be revisited periodically" or "mastering these concepts will improve your investing."
- **No copula avoidance:** use "is" and "are" naturally. Don't replace them with "serves as," "stands as," "represents."
- **Vary sentence length.** Mix short punchy statements with slightly longer ones. Don't let every bullet be the same rhythm.
- **No curly quotes.** Use straight quotes only: " not " or ".
- **No emojis.**
- **No boldface on every other word.** Bold only formulas, key terms, and critical rules. If everything is bold, nothing is.

## Process

1. Read the full input (transcript, detailed notes, or summary).
2. Identify every distinct concept, formula, rule, framework, and actionable tip.
3. Discard all teaching scaffolding: analogies, build-up, repetition, commentary, anecdotes (unless they contain a unique fact).
4. Group concepts logically (not chronologically).
5. Write each concept as a clean, direct note.
6. Pull practical/platform tips into a separate section.
7. Pull checklists/frameworks into their own section.
8. Run a humanizer pass: scan for em dashes, AI vocabulary, significance inflation, and all patterns listed above. Fix any that remain.
9. Deliver as a single clean markdown document.

## Example transformation

**Input (from transcript):**
> "So let me explain PE ratio. PE ratio is basically... think of it like this. If you buy a shop for 10 lakh and it earns 1 lakh per year, it takes 10 years to recover your money. That's PE of 10. Simple, right? So PE equals Market Cap divided by Net Profit. Or you can also calculate it as Current Price divided by EPS, both give the same answer because the number of shares cancels out. Now here's the thing most people don't understand. PE in isolation is completely misleading because profits grow! Let me show you with Britannia..."

**Output (in notes):**
> **PE Ratio**
> - PE = Market Cap ÷ Net Profit (or Current Price ÷ EPS; both are equivalent, shares cancel out).
> - Tells you how many years of current profit it would take to equal the total market cap.
> - Misleading in isolation because profits grow. Actual recovery is faster than the PE number suggests for growing companies.
