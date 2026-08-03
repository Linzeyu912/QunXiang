import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './email.js';

describe('邮箱规范化', () => {
  it('去除首尾空格并转为小写', () => {
    expect(normalizeEmail(' User@Example.COM ')).toBe('user@example.com');
  });
});
