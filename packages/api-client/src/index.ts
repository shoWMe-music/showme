/**
 * @showme/api-client — generated TanStack Query hooks over the shoWMe API.
 *
 * Call `configureApiClient({ baseUrl, getToken })` once at app startup, then use
 * the generated hooks (e.g. `useGetApiV1Events`). Hook names are derived from the
 * HTTP method + path; adding `operationId`s to the API routes would yield cleaner
 * names — tracked as a follow-up.
 */
export {
  configureApiClient,
  customFetch,
  ApiError,
  type ApiClientConfig,
  type ApiErrorBody,
  type RequestConfig,
} from "./mutator";

export * from "./generated/default/default";
