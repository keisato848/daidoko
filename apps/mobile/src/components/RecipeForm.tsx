/**
 * Shared recipe form for create (S11) and edit (S12)
 * Accepts initialValues for pre-filling in edit mode
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { KeyboardAwareScroll } from './KeyboardAwareScroll';
import { Colors, Typography } from '../constants/theme';
import { getLocale, t, tCount, tDynamic } from '../i18n';
import { getTagsForFamily } from '../services/tag.service';
import { recipeFormSchema, type RecipeFormData } from '../validation/recipe.schema';
import { FormField } from './FormField';
import { IngredientRow } from './IngredientRow';
import { NumberStepper } from './NumberStepper';
import { PhotoPickerField } from './PhotoPickerField';
import { StepRow } from './StepRow';
import { TagSelector } from './TagSelector';

interface RecipeFormProps {
  initialValues?: RecipeFormData;
  onSubmit: (data: RecipeFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  title: string;
  onFormChange?: (data: Partial<RecipeFormData>) => void;
  /**
   * 見出しの上にステータスバー分の余白を取るか（既定 true）。
   * 上に `SourceBanner` など別の帯を置く画面は false にする — 帯の側が空けるので、
   * ここでも空けると帯と見出しの間にステータスバー 1 つ分の隙間ができる。
   */
  topInset?: boolean;
}

const DEFAULT_VALUES: RecipeFormData = {
  title: '',
  titleReading: '',
  description: '',
  servings: undefined,
  cookTimeMin: undefined,
  prepTimeMin: undefined,
  coverPhotoPath: undefined,
  placeName: '',
  ingredients: [{ name: '', amount: '', groupLabel: '', note: '' }],
  steps: [{ body: '', timerSec: undefined, photoPath: undefined }],
  tags: [],
};

export function RecipeForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  title,
  onFormChange,
  topInset = true,
}: RecipeFormProps) {
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  /** お店の料理か（R1）。**店名が入っていればお店**として開く。写真から作った直後は店名が入る */
  const [fromStore, setFromStore] = useState<boolean>(
    () => (initialValues?.placeName ?? '').trim().length > 0,
  );
  /**
   * 家に切り替える直前の店名。**戻したときに書き戻す**ための控え。
   * 実機で、家 → お店 と往復するだけで「Creperie」が黙って消えた。
   * 誤タップで消えるのは、この画面がいちばんやってはいけないこと
   */
  const [stashedPlaceName, setStashedPlaceName] = useState('');

  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<RecipeFormData>({
    resolver: zodResolver(recipeFormSchema),
    defaultValues: initialValues ?? DEFAULT_VALUES,
  });

  const {
    fields: ingredientFields,
    append: appendIngredient,
    remove: removeIngredient,
  } = useFieldArray({ control, name: 'ingredients' });

  const {
    fields: stepFields,
    append: appendStep,
    remove: removeStep,
  } = useFieldArray({ control, name: 'steps' });

  const watchedValues = useWatch({ control });

  useEffect(() => {
    onFormChange?.(watchedValues as Partial<RecipeFormData>);
  }, [watchedValues, onFormChange]);

  useEffect(() => {
    void getTagsForFamily().then((tags) => {
      setAvailableTags(tags.map((t) => t.name));
    });
  }, []);

  const handleFormSubmit = useCallback(
    async (data: RecipeFormData) => {
      setSaving(true);
      try {
        await onSubmit(data);
      } finally {
        setSaving(false);
      }
    },
    [onSubmit],
  );

  return (
    // 保存はヘッダー（スクロールの外・上）なのでキーボードに隠れない。
    // 隠れるのは**行の直下**にある「材料を追加 / 手順を追加」なので、
    // 領域を縮める `KeyboardAvoider` ではなく `KeyboardAwareScroll` で
    // フォーカス欄の下に余白を確保する（KeyboardAwareScroll のコメント参照）。
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, !topInset && styles.headerFlush]}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.cancelText}>{t('common.cancel')}</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSubmit(handleFormSubmit)}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? t('common.saving') : (submitLabel ?? t('common.save'))}
          </Text>
        </Pressable>
      </View>

      <KeyboardAwareScroll
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Basic Info */}
        <View style={styles.section}>
          <FormField
            label={t('recipe.form.titleLabel')}
            required
            value={watchedValues.title}
            onChangeText={(v) => setValue('title', v)}
            placeholder={t('recipe.form.titlePlaceholder')}
            error={tDynamic(errors.title?.message)}
          />
          {/* 読みがなは**かな検索のための欄**で、日本語ロケールでしか意味を成さない。
              英語 UI に出すと「Reading」という直訳ラベルだけが残り、フォーム全体の
              信頼を下げる（1.12.2 のペルソナレビューで英語話者が指摘 —
              docs/reviews/persona/1.12.2.md #9）。値は保持されるので、
              ja に切り替えれば編集できる */}
          {getLocale() === 'ja' && (
            <FormField
              label={t('recipe.form.readingLabel')}
              value={watchedValues.titleReading}
              onChangeText={(v) => setValue('titleReading', v)}
              placeholder={t('recipe.form.readingPlaceholder')}
            />
          )}
          <FormField
            label={t('recipe.form.descriptionLabel')}
            value={watchedValues.description}
            onChangeText={(v) => setValue('description', v)}
            placeholder={t('recipe.form.descriptionPlaceholder')}
            multiline
            style={styles.multilineInput}
          />
          {/* お店の料理か家の料理か（R1）。写真から作ると既定はお店になるので、
              **あとから直せる場所がここ**。切り替えは店名の有無で表す —
              専用の列を足すより、画面に出ている事実（お店の名前）と一致していた方が
              利用者に見える状態が 1 つで済む */}
          <Text style={styles.originLabel}>{t('recipe.form.originLabel')}</Text>
          <View style={styles.originToggle}>
            {(
              [
                [true, t('recipe.form.originStore')],
                [false, t('recipe.form.originHome')],
              ] as const
            ).map(([store, label]) => {
              const selected = fromStore === store;
              return (
                <Pressable
                  key={String(store)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.originChip, selected && styles.originChipActive]}
                  onPress={() => {
                    setFromStore(store);
                    if (store) {
                      // お店へ戻したら、控えてあった店名を書き戻す（往復で消さない）
                      if (stashedPlaceName) setValue('placeName', stashedPlaceName);
                    } else {
                      // 家にしたら店名は持たない。「家の料理なのに店名がある」状態を作らない。
                      // ただし**捨てずに控える** — 戻したときに書き戻せるように
                      setStashedPlaceName((watchedValues.placeName ?? '').trim());
                      setValue('placeName', '');
                    }
                  }}
                >
                  <Text style={[styles.originChipText, selected && styles.originChipTextActive]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {/* お店の名前はレシピの属性。**あとから思い出して足せる**ことがこの欄の存在理由 */}
          {fromStore && (
            <FormField
              label={t('recipe.form.placeLabel')}
              value={watchedValues.placeName ?? ''}
              onChangeText={(v) => setValue('placeName', v)}
              placeholder={t('recipe.form.placePlaceholder')}
            />
          )}
          <View style={styles.stepperRow}>
            <NumberStepper
              label={t('common.servings')}
              value={watchedValues.servings}
              onChange={(v) => setValue('servings', v)}
              suffix={tCount('recipe.detail.servingsUnit', watchedValues.servings ?? 1)}
            />
            <NumberStepper
              label={t('common.cookTime')}
              value={watchedValues.cookTimeMin}
              onChange={(v) => setValue('cookTimeMin', v)}
              step={5}
              suffix={t('recipe.form.minutesSuffix')}
            />
          </View>
        </View>

        {/* Cover Photo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('recipe.form.photoSection')}</Text>
          <PhotoPickerField
            variant="cover"
            value={watchedValues.coverPhotoPath || undefined}
            onChange={(path) => setValue('coverPhotoPath', path)}
            title={watchedValues.title}
            ingredientNames={(watchedValues.ingredients ?? [])
              .map((ing) => ing?.name?.trim())
              .filter((name): name is string => Boolean(name))}
            tags={watchedValues.tags ?? []}
          />
        </View>

        {/* Ingredients */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('common.ingredients')}</Text>
          {errors.ingredients?.message && (
            <Text style={styles.sectionError}>{tDynamic(errors.ingredients.message)}</Text>
          )}
          {ingredientFields.map((field, index) => (
            <IngredientRow
              key={field.id}
              name={watchedValues.ingredients?.[index]?.name ?? ''}
              amount={watchedValues.ingredients?.[index]?.amount ?? ''}
              groupLabel={watchedValues.ingredients?.[index]?.groupLabel ?? ''}
              onChangeName={(v) => setValue(`ingredients.${index}.name`, v)}
              onChangeAmount={(v) => setValue(`ingredients.${index}.amount`, v)}
              onChangeGroup={(v) => setValue(`ingredients.${index}.groupLabel`, v)}
              onRemove={() => removeIngredient(index)}
              showGroup={
                index === 0 ||
                watchedValues.ingredients?.[index]?.groupLabel !==
                  watchedValues.ingredients?.[index - 1]?.groupLabel
              }
            />
          ))}
          <Pressable
            style={styles.addRowButton}
            onPress={() => appendIngredient({ name: '', amount: '', groupLabel: '', note: '' })}
          >
            <Text style={styles.addRowButtonText}>{t('recipe.form.addIngredient')}</Text>
          </Pressable>
        </View>

        {/* Steps */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('common.steps')}</Text>
          {errors.steps?.message && (
            <Text style={styles.sectionError}>{tDynamic(errors.steps.message)}</Text>
          )}
          {stepFields.map((field, index) => (
            <StepRow
              key={field.id}
              index={index}
              body={watchedValues.steps?.[index]?.body ?? ''}
              timerSec={watchedValues.steps?.[index]?.timerSec}
              photoPath={watchedValues.steps?.[index]?.photoPath || undefined}
              onChangeBody={(v) => setValue(`steps.${index}.body`, v)}
              onChangeTimer={(v) => setValue(`steps.${index}.timerSec`, v)}
              onChangePhoto={(v) => setValue(`steps.${index}.photoPath`, v)}
              onRemove={() => removeStep(index)}
            />
          ))}
          <Pressable
            style={styles.addRowButton}
            onPress={() => appendStep({ body: '', timerSec: undefined, photoPath: undefined })}
          >
            <Text style={styles.addRowButtonText}>{t('recipe.form.addStep')}</Text>
          </Pressable>
        </View>

        {/* Tags */}
        <View style={styles.section}>
          <TagSelector
            selectedTags={watchedValues.tags ?? []}
            availableTags={availableTags}
            onToggle={(tag) => {
              const current = watchedValues.tags ?? [];
              if (current.includes(tag)) {
                setValue(
                  'tags',
                  current.filter((t) => t !== tag),
                );
              } else {
                setValue('tags', [...current, tag]);
              }
            }}
            onAdd={(tag) => {
              const current = watchedValues.tags ?? [];
              setValue('tags', [...current, tag]);
              if (!availableTags.includes(tag)) {
                setAvailableTags([...availableTags, tag]);
              }
            }}
          />
        </View>
      </KeyboardAwareScroll>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 54,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerFlush: {
    paddingTop: 12,
  },
  headerTitle: {
    fontSize: 15, // base: フォームタイトル
    fontWeight: '500',
    color: Colors.paper,
    letterSpacing: 0.5,
  },
  cancelText: {
    fontSize: 15, // base: キャンセルリンク
    fontWeight: '400',
    color: Colors.goldDim,
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.gold,
    borderRadius: 8,
  },
  saveButtonDisabled: {
    // 半透過の gold は「押せるのか分からない」（ペルソナレビュー 1.12.2 #8）。
    // 無彩色に落として保存中＝押せない、を形で伝える
    opacity: 0.5,
    backgroundColor: Colors.bgInput,
  },
  saveButtonText: {
    fontSize: 13, // sm: 保存ボタン（小さめ）
    fontWeight: '600',
    color: Colors.bg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  section: {
    paddingHorizontal: 20,
    paddingTop: 20,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 20,
  },
  sectionTitle: {
    fontSize: 13, // sm: セクションタイトル
    fontWeight: '500',
    color: Colors.gold,
    letterSpacing: 1,
    marginBottom: 12,
  },
  sectionError: {
    fontSize: 12, // xs: バリデーションエラー
    fontWeight: '400',
    color: '#FF6B6B',
    marginBottom: 8,
  },
  originLabel: {
    fontSize: Typography.size.sm,
    color: Colors.paperDim,
    marginBottom: 6,
  },
  originToggle: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  originChip: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  originChipActive: {
    borderColor: Colors.gold,
    backgroundColor: '#1C1409',
  },
  originChipText: {
    fontSize: Typography.size.sm,
    color: Colors.paperDim,
  },
  originChipTextActive: {
    color: Colors.gold,
  },
  stepperRow: {
    flexDirection: 'row',
    gap: 20,
  },
  multilineInput: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  addRowButton: {
    paddingVertical: 11,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  addRowButtonText: {
    fontSize: 13, // sm: 追加ボタンテキスト
    fontWeight: '400',
    color: Colors.goldDim,
  },
});
