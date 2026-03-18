import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { reportError } from '../services/error/errorReporter';

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  errorMessage: string | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Error inesperado',
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled render error', {
      message: error?.message,
      stack: error?.stack,
      componentStack: errorInfo?.componentStack,
    });
    void reportError(error, {
      code: 'UNHANDLED_ERROR',
      severity: 'CRITICAL',
      metadata: { componentStack: errorInfo?.componentStack },
      isFatal: true,
    });
  }

  private handleRetry = () => {
    this.setState({
      hasError: false,
      errorMessage: null,
    });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <View style={styles.container}>
        <Text style={styles.title}>Algo salio mal</Text>
        <Text style={styles.message}>
          {this.state.errorMessage || 'La aplicacion encontro un error inesperado.'}
        </Text>
        <Pressable style={styles.button} onPress={this.handleRetry}>
          <Text style={styles.buttonText}>Reintentar</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    textAlign: 'center',
    color: '#555',
    marginBottom: 16,
  },
  button: {
    backgroundColor: '#1a73e8',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
  },
});
