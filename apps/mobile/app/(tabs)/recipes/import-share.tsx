/**
 * 共有リンクから取り込む（#198）。
 *
 * `?kind=recipe|book&slug=...` で開く。レシピなら URL 取り込みと同じ RecipeForm で確認してから
 * 保存。帖なら収録レシピを並べて、1 品ずつ／まとめて保存する。出所は `sources.type = 'share'`。
 */
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAvoider } from '../../../src/components/KeyboardAvoider';
import { RecipeForm } from '../../../src/components/RecipeForm';
import { Toast } from '../../../src/components/Toast';
import { Colors } from '../../../src/constants/theme';
import { API_V1 } from '../../../src/config';
import { t, tCount } from '../../../src/i18n';
import { dialog } from '../../../src/services/dialog.service';
import { createRecipe } from '../../../src/services/recipe.service';
import {
  ShareImportError,
  fetchSharedBook,
  fetchSharedRecipe,
  type SharedBookJson,
  type SharedRecipeJson,
} from '../../../src/services/share-import.service';
import { createShareSource } from '../../../src/services/source.service';
import type { RecipeFormData } from '../../../src/validation/recipe.schema';

type Phase = 'loading' | 'passcode' | 'error' | 'recipe' | 'book' | 'done';

function shareUrlFor(kind: 'recipe' | 'book', slug: string): string {
  const base = API_V1.replace(/\/api\/v1$/, '');
  return `${base}/${kind === 'recipe' ? 'r' : 'b'}/${slug}`;
}

function toFormData(
  recipe: Omit<SharedRecipeJson, 'slug' | 'locale' | 'hasPhoto'>,
): RecipeFormData {
  return {
    title: recipe.title,
    titleReading: '',
    description: recipe.description ?? '',
    servings: recipe.servings ?? undefined,
    cookTimeMin: recipe.cookTimeMin ?? undefined,
    prepTimeMin: undefined,
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      amount: i.amount ?? '',
      groupLabel: i.groupLabel ?? '',
      note: i.note ?? '',
    })),
    steps: recipe.steps.map((s) => ({ body: s.body, timerSec: undefined })),
    tags: recipe.tags,
  } as RecipeFormData;
}

function errorText(code: ShareImportError['code']): string {
  switch (code) {
    case 'NOT_FOUND':
      return t('recipeImport.share.error.notFound');
    case 'PASSCODE_LOCKED':
      return t('recipeImport.share.error.locked');
    case 'NETWORK':
      return t('recipeImport.share.error.network');
    default:
      return t('recipeImport.share.error.server');
  }
}

export default function ImportShareScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; slug?: string }>();
  const kind: 'recipe' | 'book' = params.kind === 'book' ? 'book' : 'recipe';
  const slug = typeof params.slug === 'string' ? params.slug : '';

  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [recipe, setRecipe] = useState<SharedRecipeJson | null>(null);
  const [book, setBook] = useState<SharedBookJson | null>(null);
  const [passcode, setPasscode] = useState('');
  const [passcodeWrong, setPasscodeWrong] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [savingAll, setSavingAll] = useState(false);
  const [showToast, setShowToast] = useState(false);

  const load = useCallback(
    async (code?: string) => {
      setPhase('loading');
      try {
        if (kind === 'recipe') {
          setRecipe(await fetchSharedRecipe(slug));
          setPhase('recipe');
        } else {
          setBook(await fetchSharedBook(slug, code));
          setPhase('book');
        }
      } catch (err) {
        if (err instanceof ShareImportError && err.code === 'PASSCODE_REQUIRED') {
          setPasscodeWrong(false);
          setPhase('passcode');
          return;
        }
        if (err instanceof ShareImportError && err.code === 'PASSCODE_WRONG') {
          setPasscodeWrong(true);
          setPhase('passcode');
          return;
        }
        setError(err instanceof ShareImportError ? errorText(err.code) : errorText('SERVER'));
        setPhase('error');
      }
    },
    [kind, slug],
  );

  useEffect(() => {
    if (!slug) {
      setError(errorText('NOT_FOUND'));
      setPhase('error');
      return;
    }
    void load();
  }, [load, slug]);

  const saveOne = useCallback(
    async (data: RecipeFormData, title: string) => {
      const sourceId = await createShareSource({ url: shareUrlFor(kind, slug), pageTitle: title });
      await createRecipe({ ...data, sourceId });
    },
    [kind, slug],
  );

  const handleSaveRecipe = useCallback(
    async (data: RecipeFormData) => {
      await saveOne(data, data.title);
      setShowToast(true);
      setPhase('done');
      setTimeout(() => router.replace('/(tabs)/recipes'), 1200);
    },
    [router, saveOne],
  );

  const handleSaveAll = useCallback(async () => {
    if (!book || savingAll) return;
    setSavingAll(true);
    let count = 0;
    try {
      for (const item of book.recipes) {
        await saveOne(toFormData(item), item.title);
        count += 1;
      }
      setSavedCount(count);
      setShowToast(true);
      setPhase('done');
      setTimeout(() => router.replace('/(tabs)/recipes'), 1200);
    } catch {
      void dialog.alert({
        title: t('recipeImport.share.title'),
        message: t('recipeImport.share.error.server'),
      });
    } finally {
      setSavingAll(false);
    }
  }, [book, router, saveOne, savingAll]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* パスコード入力が下端に来るので、入力欄のある画面の規約どおり包む（#172） */}
      <KeyboardAvoider style={styles.flex}>
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            accessibilityLabel={t('common.back')}
          >
            <ChevronLeft size={22} color={Colors.gold} />
          </Pressable>
          <Text style={styles.headerTitle}>{t('recipeImport.share.title')}</Text>
          <View style={{ width: 22 }} />
        </View>

        {phase === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator color={Colors.gold} />
            <Text style={styles.muted}>{t('recipeImport.share.loading')}</Text>
          </View>
        )}

        {phase === 'error' && (
          <View style={styles.center}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable
              style={styles.secondaryBtn}
              onPress={() => router.replace('/(tabs)/recipes')}
            >
              <Text style={styles.secondaryBtnText}>{t('recipeImport.share.backToLibrary')}</Text>
            </Pressable>
          </View>
        )}

        {phase === 'passcode' && (
          <View style={styles.center}>
            <Text style={styles.lead}>{t('recipeImport.share.passcodeLead')}</Text>
            <TextInput
              style={styles.passcodeInput}
              value={passcode}
              onChangeText={(v) => setPasscode(v.replace(/[^0-9]/g, '').slice(0, 4))}
              keyboardType="number-pad"
              maxLength={4}
              placeholder="0000"
              placeholderTextColor={Colors.muted}
            />
            {passcodeWrong && (
              <Text style={styles.errorText}>{t('recipeImport.share.error.wrong')}</Text>
            )}
            <Pressable
              style={[styles.primaryBtn, passcode.length !== 4 && styles.disabled]}
              disabled={passcode.length !== 4}
              onPress={() => void load(passcode)}
            >
              <Text style={styles.primaryBtnText}>{t('recipeImport.share.unlock')}</Text>
            </Pressable>
          </View>
        )}

        {phase === 'recipe' && recipe && (
          <View style={styles.flex}>
            <Text style={styles.lead}>{t('recipeImport.share.recipeLead')}</Text>
            <RecipeForm
              title={t('recipeImport.share.title')}
              initialValues={toFormData(recipe)}
              onSubmit={handleSaveRecipe}
              onCancel={() => router.back()}
              submitLabel={t('recipeImport.share.save')}
            />
          </View>
        )}

        {phase === 'book' && book && (
          <ScrollView contentContainerStyle={styles.bookContent}>
            <Text style={styles.bookTitle}>{book.title}</Text>
            {book.description ? <Text style={styles.muted}>{book.description}</Text> : null}
            <Text style={styles.lead}>
              {tCount('recipeImport.share.bookLead', book.recipes.length)}
            </Text>
            {book.recipes.map((item, index) => (
              <View key={`${index}-${item.title}`} style={styles.bookRow}>
                <Text style={styles.bookRowTitle}>{item.title}</Text>
                <Text style={styles.muted}>
                  {tCount('recipeImport.share.ingredientCount', item.ingredients.length)}
                </Text>
              </View>
            ))}
            <Pressable
              style={[styles.primaryBtn, savingAll && styles.disabled]}
              disabled={savingAll}
              onPress={() => void handleSaveAll()}
            >
              <Text style={styles.primaryBtnText}>
                {savingAll
                  ? t('recipeImport.share.saving')
                  : tCount('recipeImport.share.saveAll', book.recipes.length)}
              </Text>
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoider>
      <Toast
        visible={showToast}
        message={
          kind === 'book'
            ? tCount('recipeImport.share.savedCount', savedCount)
            : t('recipeImport.share.saved')
        }
        onDismiss={() => setShowToast(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { color: Colors.paper, fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  lead: {
    color: Colors.paper,
    fontSize: 14,
    lineHeight: 21,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  muted: { color: Colors.muted, fontSize: 12 },
  errorText: { color: '#FF6B6B', fontSize: 14, textAlign: 'center' },
  passcodeInput: {
    width: 140,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingVertical: 10,
    color: Colors.paper,
    fontSize: 24,
    textAlign: 'center',
    letterSpacing: 8,
    backgroundColor: Colors.bgInput,
  },
  primaryBtn: {
    backgroundColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 12,
  },
  primaryBtnText: { color: Colors.bg, fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: Colors.gold,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  secondaryBtnText: { color: Colors.gold, fontSize: 14 },
  disabled: { opacity: 0.4 },
  bookContent: { padding: 20, gap: 8 },
  bookTitle: { color: Colors.paper, fontSize: 20, fontWeight: '600' },
  bookRow: { borderBottomWidth: 1, borderBottomColor: Colors.border, paddingVertical: 10 },
  bookRowTitle: { color: Colors.paper, fontSize: 15 },
});
