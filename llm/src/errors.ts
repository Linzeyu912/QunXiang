/**
 * Custom error class for LLM-related errors
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly code: LLMErrorCode,
    public readonly recoverable: boolean = true
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export type LLMErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'VALIDATION_ERROR'
  | 'TIMEOUT'
  | 'MODEL_NOT_FOUND'
  | 'UNKNOWN';

/**
 * Thrown when provider is not configured (for example no API key)
 */
export class ProviderNotConfiguredError extends LLMError {
  constructor(provider: string) {
    super(
      `Provider '${provider}' is not configured. Please check your configuration.`,
      provider,
      'AUTH_ERROR',
      false
    );
  }
}

/**
 * Thrown when model is not found or not downloaded
 */
export class ModelNotFoundError extends LLMError {
  constructor(provider: string, model: string) {
    super(
      `Model '${model}' not found. Please download it first.`,
      provider,
      'MODEL_NOT_FOUND',
      true
    );
  }
}

/**
 * Map HTTP/network errors to LLMError codes with detailed diagnostics
 */
export function mapProviderError(error: unknown, provider: string): LLMError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    const fullMessage = error.message;

    // Authentication errors (401, 403, unauthorized, API key issues)
    if (message.includes('401') || message.includes('unauthorized') || message.includes('api key')) {
      return new LLMError(
        `Authentication failed for ${provider}. Check LLM_API_KEY.`,
        provider,
        'AUTH_ERROR',
        false
      );
    }

    // Access denied / forbidden (403)
    if (message.includes('403') || message.includes('forbidden') || message.includes('access denied')) {
      return new LLMError(
        `Access denied by ${provider}. Check API permissions.`,
        provider,
        'AUTH_ERROR',
        false
      );
    }

    // Rate limiting (429)
    if (message.includes('429') || message.includes('rate limit') || message.includes('too many requests')) {
      return new LLMError(
        `Rate limited by ${provider}. Try again later or increase LLM_TIMEOUT.`,
        provider,
        'RATE_LIMIT',
        true
      );
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out') || message.includes('etimedout')) {
      return new LLMError(
        `Timeout connecting to ${provider}. Increase LLM_TIMEOUT (current: 5min).`,
        provider,
        'TIMEOUT',
        true
      );
    }

    // Network unreachable - distinguish different cases
    if (message.includes('fetch') || message.includes('network') || message.includes('econnrefused') ||
        message.includes('enotfound') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') ||
        message.includes('failed to fetch') || message.includes('networkerror')) {

      // Provide more specific guidance based on the error
      if (message.includes('enotfound') || message.includes('getaddrinfo') || message.includes('nodename nor')) {
        return new LLMError(
          `DNS resolution failed for ${provider}. Check LLM_BASE_URL is correct.`,
          provider,
          'NETWORK_ERROR',
          true
        );
      }

      if (message.includes('econnrefused') || message.includes('connection refused')) {
        return new LLMError(
          `Connection refused by ${provider}. Is the server running? Check LLM_BASE_URL.`,
          provider,
          'NETWORK_ERROR',
          true
        );
      }

      return new LLMError(
        `Network error: cannot reach ${provider}. Check LLM_BASE_URL and firewall settings.`,
        provider,
        'NETWORK_ERROR',
        true
      );
    }

    // Model not found or not downloaded
    if (message.includes('model') && (message.includes('not found') || message.includes('does not exist') || message.includes('not exist'))) {
      return new LLMError(
        `Model not found for ${provider}. Check LLM_MODEL.`,
        provider,
        'MODEL_NOT_FOUND',
        true
      );
    }

    // Catch-all for known error patterns
    if (message.includes('model')) {
      return new LLMError(`Model error: ${fullMessage}`, provider, 'MODEL_NOT_FOUND', true);
    }
  }

  // Unknown error - include original message for debugging
  return new LLMError(
    error instanceof Error ? error.message : String(error),
    provider,
    'UNKNOWN',
    true
  );
}
