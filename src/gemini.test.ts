import { describe, it, expect, vi } from 'vitest';

// Mock the config module before importing gemini
vi.mock('./config.js', () => ({
  GOOGLE_API_KEY: 'test-key-123',
  GEMINI_MODEL: 'gemini-test-model',
}));

vi.mock('./kill-switches.js', () => ({
  requireEnabled: vi.fn(),
}));

const generateContentMock = vi.fn().mockResolvedValue({ text: '{"ok":true}' });
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

vi.mock('./logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { generateContent, parseJsonResponse } from './gemini.js';

describe('parseJsonResponse', () => {
  it('parses valid JSON', () => {
    const result = parseJsonResponse<{ name: string }>('{"name": "test"}');
    expect(result).toEqual({ name: 'test' });
  });

  it('parses JSON with markdown code fences', () => {
    const result = parseJsonResponse<{ skip: boolean }>('```json\n{"skip": true}\n```');
    expect(result).toEqual({ skip: true });
  });

  it('parses JSON with plain code fences', () => {
    const result = parseJsonResponse<{ val: number }>('```\n{"val": 42}\n```');
    expect(result).toEqual({ val: 42 });
  });

  it('handles leading/trailing whitespace', () => {
    const result = parseJsonResponse<{ ok: boolean }>('  \n  {"ok": true}  \n  ');
    expect(result).toEqual({ ok: true });
  });

  it('returns null for invalid JSON', () => {
    const result = parseJsonResponse('not json at all');
    expect(result).toBeNull();
  });

  it('returns null for empty string', () => {
    const result = parseJsonResponse('');
    expect(result).toBeNull();
  });

  it('returns null for truncated JSON', () => {
    const result = parseJsonResponse('{"summary": "unfinished');
    expect(result).toBeNull();
  });

  it('parses complex nested objects', () => {
    const json = JSON.stringify({
      summary: 'User prefers dark mode',
      entities: ['dark mode', 'UI preferences'],
      topics: ['preferences', 'UI'],
      importance: 0.8,
    });
    const result = parseJsonResponse<{ summary: string; importance: number }>(json);
    expect(result).not.toBeNull();
    expect(result!.summary).toBe('User prefers dark mode');
    expect(result!.importance).toBe(0.8);
  });

  it('parses arrays', () => {
    const result = parseJsonResponse<string[]>('["a", "b", "c"]');
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('handles case-insensitive code fence language tag', () => {
    const result = parseJsonResponse<{ v: number }>('```JSON\n{"v": 1}\n```');
    expect(result).toEqual({ v: 1 });
  });
});

describe('generateContent', () => {
  it('uses the configured GEMINI_MODEL by default', async () => {
    const text = await generateContent('hello');
    expect(text).toBe('{"ok":true}');
    expect(generateContentMock).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gemini-test-model', contents: 'hello' }),
    );
  });

  it('accepts an explicit model override', async () => {
    await generateContent('hello', 'gemini-other');
    expect(generateContentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ model: 'gemini-other' }),
    );
  });
});
