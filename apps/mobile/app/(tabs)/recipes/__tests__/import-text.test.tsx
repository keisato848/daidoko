import { fireEvent, render, screen } from '@testing-library/react-native';
import { Clipboard } from 'react-native';

import ImportTextScreen from '../import-text';
import { RECIPE_TEXT_AI_PROMPT } from '../../../../src/utils/recipeTextParser';

jest.mock('expo-router', () => ({
  useRouter: () => ({
    back: jest.fn(),
    replace: jest.fn(),
  }),
}));

describe('ImportTextScreen', () => {
  it('copies the AI prompt template to the clipboard', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(jest.fn());
    const setStringSpy = jest.spyOn(Clipboard, 'setString').mockImplementation(jest.fn());

    render(<ImportTextScreen />);
    fireEvent.press(screen.getByText('AI用指示をコピー'));

    expect(setStringSpy).toHaveBeenCalledWith(RECIPE_TEXT_AI_PROMPT);
    setStringSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
