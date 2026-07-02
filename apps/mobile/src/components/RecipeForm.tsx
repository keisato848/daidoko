/**
 * Shared recipe form for create (S11) and edit (S12)
 * Accepts initialValues for pre-filling in edit mode
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useState } from 'react';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Colors } from '../constants/theme';
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
}

const DEFAULT_VALUES: RecipeFormData = {
  title: '',
  titleReading: '',
  description: '',
  servings: undefined,
  cookTimeMin: undefined,
  prepTimeMin: undefined,
  coverPhotoPath: undefined,
  ingredients: [{ name: '', amount: '', groupLabel: '', note: '' }],
  steps: [{ body: '', timerSec: undefined, photoPath: undefined }],
  tags: [],
};

export function RecipeForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = '保存',
  title,
  onFormChange,
}: RecipeFormProps) {
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={onCancel} hitSlop={12}>
          <Text style={styles.cancelText}>キャンセル</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <Pressable
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={handleSubmit(handleFormSubmit)}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>{saving ? '保存中...' : submitLabel}</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Basic Info */}
        <View style={styles.section}>
          <FormField
            label="レシピ名"
            required
            value={watchedValues.title}
            onChangeText={(v) => setValue('title', v)}
            placeholder="例: 肉じゃが"
            error={errors.title?.message}
          />
          <FormField
            label="読みがな"
            value={watchedValues.titleReading}
            onChangeText={(v) => setValue('titleReading', v)}
            placeholder="例: にくじゃが"
          />
          <FormField
            label="説明"
            value={watchedValues.description}
            onChangeText={(v) => setValue('description', v)}
            placeholder="レシピの簡単な説明（任意）"
            multiline
            style={styles.multilineInput}
          />
          <View style={styles.stepperRow}>
            <NumberStepper
              label="人数"
              value={watchedValues.servings}
              onChange={(v) => setValue('servings', v)}
              suffix="人前"
            />
            <NumberStepper
              label="調理時間"
              value={watchedValues.cookTimeMin}
              onChange={(v) => setValue('cookTimeMin', v)}
              step={5}
              suffix="分"
            />
          </View>
        </View>

        {/* Cover Photo */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>写真</Text>
          <PhotoPickerField
            variant="cover"
            value={watchedValues.coverPhotoPath || undefined}
            onChange={(path) => setValue('coverPhotoPath', path)}
          />
        </View>

        {/* Ingredients */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>材料</Text>
          {errors.ingredients?.message && (
            <Text style={styles.sectionError}>{errors.ingredients.message}</Text>
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
            <Text style={styles.addRowButtonText}>＋ 材料を追加</Text>
          </Pressable>
        </View>

        {/* Steps */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>手順</Text>
          {errors.steps?.message && <Text style={styles.sectionError}>{errors.steps.message}</Text>}
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
            <Text style={styles.addRowButtonText}>＋ 手順を追加</Text>
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
      </ScrollView>
    </KeyboardAvoidingView>
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
    opacity: 0.5,
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
