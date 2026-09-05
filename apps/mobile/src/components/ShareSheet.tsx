/**
 * 統一共有シート（docs/共有設計.md §3-2・R2）。
 *
 * 共有アクションはすべてここに集約し、利用者には「相手」で 2 つ＋副項目 1 つだけを見せる:
 *   ● 家族と共有 — グループのメンバーだけに見える（自動同期）
 *   ● リンクで渡す — リンクを知る人は誰でも・いつまでも見られる
 *   ○ テキストで送る — 取り込み書式のテキスト（副項目）
 * **可視範囲の 1 行は省略不可**（§3-2 の決定）。仕組み名（Web共有・クラウド同期）は出さない。
 */
import { ChevronRight, FileText, Link2, Users } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BottomSheet } from './BottomSheet';
import { Colors } from '../constants/theme';
import { t } from '../i18n';

interface ShareSheetProps {
  visible: boolean;
  onClose: () => void;
  /** 家族グループに参加済みか（未参加なら参加導線を出す） */
  familyJoined: boolean;
  /** リンク発行済みか */
  linkShared: boolean;
  /** URL 取り込み由来などでリンク共有が塞がれているか（出所ゲート） */
  linkBlocked: boolean;
  onFamily: () => void;
  /** 未発行なら発行（権利確認込み）、発行済みなら再送 */
  onLinkSend: () => void;
  onLinkStop: () => void;
  onTextSend: () => void;
}

export function ShareSheet({
  visible,
  onClose,
  familyJoined,
  linkShared,
  linkBlocked,
  onFamily,
  onLinkSend,
  onLinkStop,
  onTextSend,
}: ShareSheetProps) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={t('recipe.detail.shareSheet.title')}>
      {/* ── 家族と共有 ── */}
      <Pressable style={styles.row} onPress={onFamily}>
        <Users size={20} color={Colors.gold} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle}>
            {familyJoined
              ? t('recipe.detail.shareSheet.familyJoined')
              : t('recipe.detail.shareSheet.familyNotJoined')}
          </Text>
          <Text style={styles.rowNote}>{t('recipe.detail.shareSheet.familyNote')}</Text>
        </View>
        <ChevronRight size={16} color={Colors.muted} />
      </Pressable>

      {/* ── リンクで渡す ── */}
      {linkBlocked ? (
        <View style={[styles.row, styles.rowDisabled]}>
          <Link2 size={20} color={Colors.muted} />
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, styles.textDisabled]}>
              {t('recipe.detail.shareSheet.linkTitle')}
            </Text>
            <Text style={styles.rowNote}>{t('recipe.detail.shareSheet.linkBlocked')}</Text>
          </View>
        </View>
      ) : (
        <>
          <Pressable style={styles.row} onPress={onLinkSend}>
            <Link2 size={20} color={Colors.gold} />
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>
                {linkShared
                  ? t('recipe.detail.shareSheet.linkSend')
                  : t('recipe.detail.shareSheet.linkPublish')}
              </Text>
              <Text style={styles.rowNote}>{t('recipe.detail.shareSheet.linkNote')}</Text>
            </View>
            <ChevronRight size={16} color={Colors.muted} />
          </Pressable>
          {linkShared && (
            <Pressable style={styles.row} onPress={onLinkStop}>
              <Link2 size={20} color={Colors.muted} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{t('recipe.detail.shareSheet.linkStop')}</Text>
                <Text style={styles.rowNote}>{t('recipe.detail.shareSheet.linkStopNote')}</Text>
              </View>
            </Pressable>
          )}
        </>
      )}

      {/* ── テキストで送る（副項目） ── */}
      <Pressable style={[styles.row, styles.rowSecondary]} onPress={onTextSend}>
        <FileText size={18} color={Colors.goldDim} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitleSecondary}>{t('recipe.detail.shareSheet.textSend')}</Text>
          <Text style={styles.rowNote}>{t('recipe.detail.shareSheet.textNote')}</Text>
        </View>
      </Pressable>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  rowSecondary: { borderBottomWidth: 0 },
  rowDisabled: { opacity: 0.7 },
  rowBody: { flex: 1, gap: 3 },
  rowTitle: { fontSize: 15, fontWeight: '600', color: Colors.paper },
  rowTitleSecondary: { fontSize: 14, color: Colors.paper },
  rowNote: { fontSize: 12, color: Colors.paperDim, lineHeight: 17 },
  textDisabled: { color: Colors.muted },
});
