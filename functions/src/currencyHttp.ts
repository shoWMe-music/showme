/**
 * Currency / FX helpers (ported from showme exchange-rate routes).
 * Uses https://www.exchangerate-api.com/ — set EXCHANGE_RATE_API_KEY in the environment.
 */

import * as logger from "firebase-functions/logger";
import { onRequest } from "firebase-functions/v2/https";

const API_BASE_URL = "https://v6.exchangerate-api.com/v6";

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  DKK: "kr",
  SEK: "kr",
  NOK: "kr",
};

const ALLOWED_CURRENCIES = ["USD", "EUR", "GBP", "DKK", "SEK", "NOK"];

interface ExchangeRateApiResponse {
  result: string;
  base_code: string;
  conversion_rates: Record<string, number>;
}

interface SupportedCurrenciesApiResponse {
  result: string;
  supported_codes: Array<[string, string]>;
}

function getApiKey(): string | null {
  const k = process.env.EXCHANGE_RATE_API_KEY?.trim();
  return k || null;
}

const httpOpts = { region: "europe-west1" as const, cors: true };

export const exchangeRate = onRequest(httpOpts, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed", message: "Use GET" });
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    res.status(500).json({
      error: "Server misconfiguration",
      message: "Set EXCHANGE_RATE_API_KEY (see functions/.env.example).",
    });
    return;
  }

  const source = typeof req.query.source === "string" ? req.query.source : "";
  const target = typeof req.query.target === "string" ? req.query.target : "";
  const currencyCodeRegex = /^[A-Z]{3}$/;
  const sourceUpper = source.toUpperCase();
  const targetUpper = target.toUpperCase();

  if (!currencyCodeRegex.test(sourceUpper)) {
    res.status(400).json({
      error: "Bad Request",
      message:
        `Invalid source currency code: ${source}. ` +
        "Currency codes must be 3 letters (e.g. USD, EUR).",
    });
    return;
  }
  if (!currencyCodeRegex.test(targetUpper)) {
    res.status(400).json({
      error: "Bad Request",
      message:
        `Invalid target currency code: ${target}. ` +
        "Currency codes must be 3 letters (e.g. USD, EUR).",
    });
    return;
  }

  const apiUrl = `${API_BASE_URL}/${apiKey}/latest/${sourceUpper}`;
  logger.info({ apiUrl, source: sourceUpper }, "Calling exchange rate API");

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      logger.error({ status: response.status, statusText: response.statusText }, "Exchange rate API error");
      res.status(response.status).json({
        error: "API Error",
        message: `Exchange rate API returned ${response.status} ${response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as ExchangeRateApiResponse;
    if (data.result !== "success") {
      logger.error({ data }, "Exchange rate API unsuccessful result");
      res.status(500).json({
        error: "API Error",
        message: `Exchange rate API returned unsuccessful result: ${data.result}`,
      });
      return;
    }

    if (!data.conversion_rates || !(targetUpper in data.conversion_rates)) {
      res.status(404).json({
        error: "Not Found",
        message:
          `Target currency "${targetUpper}" not found in conversion rates ` +
          `for source currency "${sourceUpper}".`,
      });
      return;
    }

    const rate = data.conversion_rates[targetUpper];
    res.status(200).json({
      rate,
      sourceCurrency: sourceUpper,
      targetCurrency: targetUpper,
    });
  } catch (err) {
    logger.error({ err, source, target }, "exchangeRate handler error");
    res.status(500).json({
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export const supportedCurrencies = onRequest(httpOpts, async (req, res) => {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method Not Allowed", message: "Use GET" });
    return;
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    res.status(500).json({
      error: "Server misconfiguration",
      message: "Set EXCHANGE_RATE_API_KEY (see functions/.env.example).",
    });
    return;
  }

  const apiUrl = `${API_BASE_URL}/${apiKey}/codes`;
  logger.info({ apiUrl }, "Calling supported currencies API");

  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      res.status(response.status).json({
        error: "API Error",
        message: `Supported currencies API returned ${response.status} ${response.statusText}`,
      });
      return;
    }

    const data = (await response.json()) as SupportedCurrenciesApiResponse;
    if (data.result !== "success") {
      res.status(500).json({
        error: "API Error",
        message: `Supported currencies API returned unsuccessful result: ${data.result}`,
      });
      return;
    }

    const supportedCurrenciesList = (data.supported_codes || [])
      .filter(([code]) => ALLOWED_CURRENCIES.includes(code))
      .map(([code, name]) => ({
        code,
        name,
        symbol: CURRENCY_SYMBOLS[code] || "",
      }));

    res.status(200).json({ supportedCurrencies: supportedCurrenciesList });
  } catch (err) {
    logger.error({ err }, "supportedCurrencies handler error");
    res.status(500).json({
      error: "Internal Server Error",
      message: err instanceof Error ? err.message : "Unknown error",
    });
  }
});
