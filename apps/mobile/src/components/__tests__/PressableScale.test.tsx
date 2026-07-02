import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Text } from 'react-native';

import { PressableScale } from '../PressableScale';

describe('PressableScale', () => {
  it('children を表示する', () => {
    render(
      <PressableScale>
        <Text>押す</Text>
      </PressableScale>,
    );
    expect(screen.getByText('押す')).toBeTruthy();
  });

  it('押すと onPress が呼ばれる', () => {
    const onPress = jest.fn();
    render(
      <PressableScale onPress={onPress}>
        <Text>押す</Text>
      </PressableScale>,
    );
    fireEvent.press(screen.getByText('押す'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
