import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import History from '@/components/workspace/History';

describe('History tab', () => {
  afterEach(cleanup);
  it('is an honest empty state with no sample rows', () => {
    render(<History S={{}} contract={{ id: 'C', events: [] }} id="C" />);
    expect(screen.getByText("History isn't live yet.")).toBeTruthy();
    expect(screen.getByText(/history provider in a later release/)).toBeTruthy();
    expect(screen.queryByText(/GBX7/)).toBeNull();
    expect(screen.queryByText(/Preview build/)).toBeNull();
  });
});
