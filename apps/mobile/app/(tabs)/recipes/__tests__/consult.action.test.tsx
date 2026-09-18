import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';
import ConsultScreen from '../consult';
import { consultRecipe } from '../../../../src/services/recipe-consult.provider';
import { confirmMutate } from '../../../../src/assistant/action-runner';
import { useActionToastStore } from '../../../../src/stores/action-toast.store';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

jest.mock('../../../../src/services/recipe-consult.provider', () => ({
  consultRecipe: jest.fn(),
  ConsultError: class extends Error {},
}));

jest.mock('../../../../src/assistant/action-runner', () => ({
  confirmMutate: jest.fn(),
}));

jest.mock('../../../../src/services/shopping-list.service', () => ({
  removeShoppingItem: jest.fn(),
}));

// Mock `ensureInferenceCredit`
jest.mock('../../../../src/services/inference-gate.service', () => ({
  ensureInferenceCredit: jest.fn().mockResolvedValue('ready'),
}));

// Mock `recordCloudInference`
jest.mock('../../../../src/services/usage.service', () => ({
  recordCloudInference: jest.fn().mockResolvedValue(undefined),
}));

// Mock `dialog`
jest.mock('../../../../src/services/dialog.service', () => ({
  dialog: { confirm: jest.fn() },
}));

describe('ConsultScreen Action/Candidate UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useActionToastStore.setState({ current: null });
  });

  it('actionsを含む応答が来たとき、タップ前はconfirmMutateが呼ばれないこと。タップ後に呼ばれ、成功時はToastが表示されること', async () => {
    (consultRecipe as jest.Mock).mockResolvedValueOnce({
      reply: '玉ねぎを追加しますか？',
      ready: false,
      draft: null,
      actions: [{ id: 'shopping.add', args: { name: '玉ねぎ' }, heardAs: '玉ねぎ切らしてる' }],
    });

    (confirmMutate as jest.Mock).mockResolvedValueOnce({
      ok: true,
      item: { id: 'test-item-id' },
    });

    render(<ConsultScreen />);

    // Type something and send
    fireEvent.changeText(screen.getByPlaceholderText(/例:/), '玉ねぎ切らしてる');
    fireEvent.press(screen.getByLabelText('送る'));

    // Wait for the action card to appear
    await waitFor(() => {
      expect(screen.getByText('〈玉ねぎ切らしてる〉')).toBeTruthy();
    });

    // タップ前はconfirmMutateが呼ばれないこと
    expect(confirmMutate).not.toHaveBeenCalled();

    // ［足す］をタップ
    fireEvent.press(screen.getByText('足す'));

    // タップ後にconfirmMutateが呼ばれること
    await waitFor(() => {
      expect(confirmMutate).toHaveBeenCalledWith('shopping.add', { name: '玉ねぎ' });
    });

    // Toastが表示されること
    expect(useActionToastStore.getState().current?.message).toContain('を買い物リストに足しました');
    expect(useActionToastStore.getState().current?.action?.label).toBe('取り消す');
  });

  it('重複時の文言分岐: 重複時は取り消しボタンなしのToastになること', async () => {
    (consultRecipe as jest.Mock).mockResolvedValueOnce({
      reply: '玉ねぎを追加しますか？',
      ready: false,
      draft: null,
      actions: [{ id: 'shopping.add', args: { name: '玉ねぎ' }, heardAs: '玉ねぎ切らしてる' }],
    });

    (confirmMutate as jest.Mock).mockResolvedValueOnce({
      ok: false,
      reason: 'duplicate',
    });

    render(<ConsultScreen />);

    fireEvent.changeText(screen.getByPlaceholderText(/例:/), '玉ねぎ切らしてる');
    fireEvent.press(screen.getByLabelText('送る'));

    await waitFor(() => {
      expect(screen.getByText('〈玉ねぎ切らしてる〉')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('足す'));

    await waitFor(() => {
      expect(confirmMutate).toHaveBeenCalledWith('shopping.add', { name: '玉ねぎ' });
    });

    // Toastが表示されること（重複）
    expect(useActionToastStore.getState().current?.message).toContain(
      '「玉ねぎ」は買い物リストにあります',
    );
    expect(useActionToastStore.getState().current?.action).toBeUndefined(); // 取り消しボタンなし
  });

  it('候補一覧がタップで選択されること', async () => {
    (consultRecipe as jest.Mock).mockResolvedValueOnce({
      reply: 'どれにしますか？',
      ready: false,
      draft: null,
      candidates: [
        { title: 'ハンバーグ', description: '洋風' },
        { title: '唐揚げ', description: '和風' },
      ],
    });

    render(<ConsultScreen />);

    fireEvent.changeText(screen.getByPlaceholderText(/例:/), '肉料理');
    fireEvent.press(screen.getByLabelText('送る'));

    await waitFor(() => {
      expect(screen.getByText('ハンバーグ')).toBeTruthy();
      expect(screen.getByText('唐揚げ')).toBeTruthy();
    });

    // 候補をタップ（ハンバーグ）
    (consultRecipe as jest.Mock).mockResolvedValueOnce({
      reply: 'ハンバーグですね',
      ready: false,
      draft: null,
    });

    fireEvent.press(screen.getByText('ハンバーグ'));

    // sendが再び呼ばれる（inputがセットされる）
    await waitFor(() => {
      expect(consultRecipe).toHaveBeenCalledTimes(2);
      // メッセージ履歴の最後のユーザのテキストが「ハンバーグにします」になる
      const args = (consultRecipe as jest.Mock).mock.calls[1][0];
      const lastUserMsg = args.messages.filter((m: { role: string }) => m.role === 'user').pop();
      expect(lastUserMsg.text).toBe('ハンバーグにします');
    });
  });

  it('candidateCountがリクエストボディ(ConsultArgs)に含まれること', async () => {
    (consultRecipe as jest.Mock).mockResolvedValueOnce({
      reply: 'はい',
      ready: false,
      draft: null,
    });

    render(<ConsultScreen />);

    // 候補数を選択 (2件)
    fireEvent.press(screen.getByText('2'));

    fireEvent.changeText(screen.getByPlaceholderText(/例:/), '何か作って');
    fireEvent.press(screen.getByLabelText('送る'));

    await waitFor(() => {
      expect(consultRecipe).toHaveBeenCalledTimes(1);
      const args = (consultRecipe as jest.Mock).mock.calls[0][0];
      expect(args.candidateCount).toBe(2);
    });
  });
});
