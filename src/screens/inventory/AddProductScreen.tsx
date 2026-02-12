import React, { useState } from 'react';
import { View, StyleSheet, ScrollView, Alert, Image } from 'react-native';
import { TextInput, Button, Text, Surface } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { db } from '../../database/Database';
import { syncService } from '../../services/sync/SyncService';
import { generateLocalId } from '../../utils/helpers';

interface AddProductScreenProps {
  navigation: any;
}

export function AddProductScreen({ navigation }: AddProductScreenProps) {
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [cost, setCost] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [description, setDescription] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se necesita acceso a la galería');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permisos', 'Se necesita acceso a la cámara');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled) {
      setImageUri(result.assets[0].uri);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('Error', 'El nombre es requerido');
      return;
    }
    if (!price || isNaN(parseFloat(price))) {
      Alert.alert('Error', 'El precio es requerido');
      return;
    }
    if (!cost || isNaN(parseFloat(cost))) {
      Alert.alert('Error', 'El costo es requerido');
      return;
    }

    setLoading(true);
    try {
      const localId = generateLocalId();
      const costCents = Math.round(parseFloat(cost) * 100);
      const priceCents = Math.round(parseFloat(price) * 100);
      const stockValue = stock ? parseFloat(stock) : 0;

      const productData = {
        localId,
        name: name.trim(),
        sku: sku.trim() || null,
        costCents,
        priceCents,
        stock: stockValue,
        description: description.trim() || null,
        imageUri,
        createdAt: Date.now(),
      };

      // Guardar en SQLite
      await db.insert('products', {
        local_id: localId,
        name: productData.name,
        sku: productData.sku,
        cost_cents: costCents,
        price_cents: priceCents,
        stock: stockValue,
        synced: 0,
        data: JSON.stringify(productData),
      });

      // Agregar a cola de sincronización
      await syncService.queueOperation('product', 'create', productData, localId);

      Alert.alert('Éxito', 'Producto guardado correctamente', [
        { text: 'OK', onPress: () => navigation.goBack() }
      ]);
    } catch (error) {
      console.error('Error guardando producto:', error);
      Alert.alert('Error', 'No se pudo guardar el producto');
    } finally {
      setLoading(false);
    }
  };

  const scanBarcode = () => {
    navigation.navigate('BarcodeScanner', {
      onScan: (barcode: string) => {
        setSku(barcode);
      },
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Surface style={styles.imageSection}>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.productImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imagePlaceholderText}>Sin imagen</Text>
            </View>
          )}
          <View style={styles.imageButtons}>
            <Button mode="outlined" onPress={takePhoto} icon="camera" compact>
              Cámara
            </Button>
            <Button mode="outlined" onPress={pickImage} icon="image" compact>
              Galería
            </Button>
          </View>
        </Surface>

        <Surface style={styles.formSection}>
          <TextInput
            label="Nombre del Producto *"
            value={name}
            onChangeText={setName}
            mode="outlined"
            style={styles.input}
          />

          <View style={styles.skuRow}>
            <TextInput
              label="SKU / Código"
              value={sku}
              onChangeText={setSku}
              mode="outlined"
              style={styles.skuInput}
            />
            <Button 
              mode="outlined" 
              icon="barcode-scan" 
              onPress={scanBarcode}
              style={styles.scanButton}
            >
              Escanear
            </Button>
          </View>

          <TextInput
            label="Costo (RD$) *"
            value={cost}
            onChangeText={setCost}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            left={<TextInput.Affix text="RD$ " />}
          />

          <TextInput
            label="Precio (RD$) *"
            value={price}
            onChangeText={setPrice}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
            left={<TextInput.Affix text="RD$ " />}
          />

          <TextInput
            label="Stock Inicial"
            value={stock}
            onChangeText={setStock}
            mode="outlined"
            keyboardType="decimal-pad"
            style={styles.input}
          />

          <TextInput
            label="Descripción"
            value={description}
            onChangeText={setDescription}
            mode="outlined"
            multiline
            numberOfLines={3}
            style={styles.input}
          />
        </Surface>

        <Button
          mode="contained"
          onPress={handleSave}
          loading={loading}
          disabled={loading}
          style={styles.saveButton}
          contentStyle={styles.saveButtonContent}
        >
          Guardar Producto
        </Button>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  scrollContent: {
    padding: 12,
  },
  imageSection: {
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 12,
    elevation: 1,
  },
  productImage: {
    width: 150,
    height: 150,
    borderRadius: 8,
    marginBottom: 12,
  },
  imagePlaceholder: {
    width: 150,
    height: 150,
    borderRadius: 8,
    backgroundColor: '#e0e0e0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  imagePlaceholderText: {
    color: '#888',
  },
  imageButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  formSection: {
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    elevation: 1,
  },
  input: {
    marginBottom: 12,
  },
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  skuInput: {
    flex: 1,
    marginRight: 8,
  },
  scanButton: {
    marginTop: 6,
  },
  saveButton: {
    marginTop: 8,
    marginBottom: 20,
  },
  saveButtonContent: {
    paddingVertical: 8,
  },
});
