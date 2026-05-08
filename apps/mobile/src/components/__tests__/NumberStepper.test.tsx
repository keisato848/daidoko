import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { NumberStepper } from '../NumberStepper';

describe('NumberStepper', () => {
  it('ラベルを表示する', () => {
    render(<NumberStepper label="人数" value={undefined} onChange={jest.fn()} />);
    expect(screen.getByText('人数')).toBeTruthy();
  });

  it('value が undefined のとき「−」を表示する', () => {
    render(<NumberStepper label="人数" value={undefined} onChange={jest.fn()} />);
    // − はボタンと値表示の両方に出るため getAllByText で確認
    expect(screen.getAllByText('−').length).toBeGreaterThan(0);
  });

  it('suffix を付けて現在値を表示する', () => {
    render(<NumberStepper label="人数" value={4} onChange={jest.fn()} suffix="人前" />);
    // getByText with exact:false to handle any whitespace variation
    expect(screen.getByText('4人前', { exact: false })).toBeTruthy();
  });

  it('＋ ボタンで onChange が呼ばれる', () => {
    const onChange = jest.fn();
    render(<NumberStepper label="人数" value={2} onChange={onChange} min={1} />);
    fireEvent.press(screen.getByText('＋'));
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it('− ボタンで onChange が呼ばれる', () => {
    const onChange = jest.fn();
    render(<NumberStepper label="人数" value={3} onChange={onChange} min={1} />);
    fireEvent.press(screen.getByText('−'));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('min を下回るとき undefined を返す', () => {
    const onChange = jest.fn();
    render(<NumberStepper label="人数" value={1} onChange={onChange} min={1} />);
    fireEvent.press(screen.getByText('−'));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('step=5 で increment する', () => {
    const onChange = jest.fn();
    render(<NumberStepper label="時間" value={10} onChange={onChange} step={5} />);
    fireEvent.press(screen.getByText('＋'));
    expect(onChange).toHaveBeenCalledWith(15);
  });
});
