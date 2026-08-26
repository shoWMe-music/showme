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
// The response/request SHAPES, not just the hooks. A screen that holds one of
// these payloads in its own state or passes it to a child needs the type by name;
// without this it can only be spelled `Awaited<ReturnType<typeof getX>>`, which is
// unreadable and breaks the moment a hook is renamed.
export * from "./generated/models";
