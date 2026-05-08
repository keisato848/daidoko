/**
 * Tag chips selector with free-text creation
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors } from '../constants/theme';

interface TagSelectorProps {
  selectedTags: string[];
  availableTags: string[];
  onToggle: (tag: string) => void;
  onAdd: (tag: string) => void;
}

export function TagSelector({ selectedTags, availableTags, onToggle, onAdd }: TagSelectorProps) {
  const [newTag, setNewTag] = useState('');

  const handleAdd = () => {
    const trimmed = newTag.trim();
    if (trimmed && !selectedTags.includes(trimmed) && !availableTags.includes(trimmed)) {
      onAdd(trimmed);
    } else if (trimmed && availableTags.includes(trimmed)) {
      onToggle(trimmed);
    }
    setNewTag('');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>タグ</Text>
      <View style={styles.chips}>
        {availableTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          return (
            <Pressable
              key={tag}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => onToggle(tag)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{tag}</Text>
            </Pressable>
          );
        })}
        {selectedTags
          .filter((t) => !availableTags.includes(t))
          .map((tag) => (
            <Pressable
              key={tag}
              style={[styles.chip, styles.chipSelected]}
              onPress={() => onToggle(tag)}
            >
              <Text style={[styles.chipText, styles.chipTextSelected]}>{tag}</Text>
            </Pressable>
          ))}
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={newTag}
          onChangeText={setNewTag}
          onSubmitEditing={handleAdd}
          placeholder="新しいタグを追加"
          placeholderTextColor={Colors.muted}
          returnKeyType="done"
        />
        <Pressable
          style={[styles.addButton, !newTag.trim() && styles.addButtonDisabled]}
          onPress={handleAdd}
          disabled={!newTag.trim()}
        >
          <Text style={styles.addButtonText}>追加</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 13, // sm: タグラベル
    fontWeight: '500',
    color: Colors.paperDim,
    marginBottom: 8,
    letterSpacing: 0.5,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  chipText: {
    fontSize: 13, // sm: タグチップテキスト
    fontWeight: '400',
    color: Colors.paperDim,
  },
  chipTextSelected: {
    color: Colors.bg,
    fontWeight: '500',
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addInput: {
    flex: 1,
    backgroundColor: Colors.bgInput,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15, // base: 新規タグ入力
    fontWeight: '400',
    color: Colors.paper,
  },
  addButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.gold,
    justifyContent: 'center',
  },
  addButtonDisabled: {
    borderColor: Colors.border,
    opacity: 0.5,
  },
  addButtonText: {
    fontSize: 13, // sm: 追加ボタン
    fontWeight: '500',
    color: Colors.gold,
  },
});
