// Unit tests for features/ai/chat — the pure prompt assembly for a chat send
// (whole-document vs selection-aware, + the agent protocol and read-only
// note). Node project: buildChatMessages is pure.

import { describe, expect, it } from 'vitest';
import { buildChatMessages } from './chat';

describe('buildChatMessages', () => {
  it('composes the persona and the agent tool protocol for a plain send', () => {
    const messages = buildChatMessages({
      question: 'hi',
      hasSelection: false,
      selected: '',
      docText: 'DOC',
      readOnly: false,
    });

    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('Markdown assistant');
    expect(messages[0].content).toContain('```qalam');
    expect(messages[0].content).toContain('"edit_document"');
    expect(messages[0].content).not.toContain('READ-ONLY');
    expect(messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('announces read-only access when direct editing is off', () => {
    const messages = buildChatMessages({
      question: 'hi',
      hasSelection: false,
      selected: '',
      docText: 'DOC',
      readOnly: true,
    });

    expect(messages[0].content).toContain('READ-ONLY access');
  });

  it('pins the captured selection and the replace-selection directive on selection-aware sends', () => {
    const messages = buildChatMessages({
      question: 'make it formal',
      hasSelection: true,
      selected: 'Body text here',
      docText: '# Title\n\nBody text here',
      readOnly: false,
    });

    const system = messages[0];
    expect(system.role).toBe('system');
    expect(system.content).toContain('replace-selection');
    expect(system.content).toContain('Apply their instruction to that selection');

    const user = messages[messages.length - 1];
    expect(user.content).toContain('make it formal');
    expect(user.content).toContain('<selection>\nBody text here\n</selection>');
    expect(user.content).toContain('<document>');
  });

  it('keeps selection-aware sends read-only without the replace directive', () => {
    const messages = buildChatMessages({
      question: 'make it formal',
      hasSelection: true,
      selected: 'Body text here',
      docText: '# Title',
      readOnly: true,
    });

    expect(messages[0].content).toContain('READ-ONLY access');
    expect(messages[0].content).not.toContain('"replace-selection" mode');
  });
});
