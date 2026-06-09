-- Runtime indexes for overview, raw explorer and report queries.
-- Run with psql in autocommit mode. Do not wrap this file in a transaction,
-- because CREATE INDEX CONCURRENTLY is not allowed inside transactions.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfr_provider_country_started
  ON "ProviderFetchRun" ("providerId", "countryId", "startedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfr_success_started
  ON "ProviderFetchRun" ("success", "startedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfr_reviewed_started
  ON "ProviderFetchRun" ("reviewedAt", "startedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pfr_country_started
  ON "ProviderFetchRun" ("countryId", "startedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rpr_provider_received
  ON "RawProviderResponse" ("providerId", "receivedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rpr_flight_processed
  ON "RawProviderResponse" ("flightProcessedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_observed
  ON "RawFlightObservation" ("observedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_fetch_run
  ON "RawFlightObservation" ("fetchRunId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_provider_fetch_run
  ON "RawFlightObservation" ("providerId", "fetchRunId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_raw_response
  ON "RawFlightObservation" ("rawResponseId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_provider_detected_flight
  ON "RawFlightObservation" ("providerId", "detectedFlightId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_provider_icao24_observed
  ON "RawFlightObservation" ("providerId", "icao24", "observedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_rfo_provider_callsign_observed
  ON "RawFlightObservation" ("providerId", "callsign", "observedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feq_source_status_report_date
  ON "FlightEnrichmentQuery" ("source", "status", "reportDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feq_airline_flight
  ON "FlightEnrichmentQuery" ("parsedAirlineCode", "parsedFlightNumber");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feq_route_outbound
  ON "FlightEnrichmentQuery" ("originAirportCode", "destinationAirportCode", "outboundDate");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feq_requested
  ON "FlightEnrichmentQuery" ("requestedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_feq_completed
  ON "FlightEnrichmentQuery" ("completedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pdfc_flight_country
  ON "ProviderDetectedFlightCountry" ("detectedFlightId", "countryId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pdfc_first_observed
  ON "ProviderDetectedFlightCountry" ("firstObservedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pdfc_last_observed
  ON "ProviderDetectedFlightCountry" ("lastObservedAt");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fol_normalized_flight
  ON "FlightObservationLink" ("normalizedFlightId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_fol_raw_observation
  ON "FlightObservationLink" ("rawFlightObservationId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cot_country
  ON "CountryObservationTag" ("countryId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cot_country_observation
  ON "CountryObservationTag" ("countryId", "rawFlightObservationId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cot_observation_country
  ON "CountryObservationTag" ("rawFlightObservationId", "countryId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cot_collection_area
  ON "CountryObservationTag" ("collectionAreaId");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pdm_date
  ON "ProviderDailyMetric" ("date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pdm_provider_date
  ON "ProviderDailyMetric" ("providerId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pdm_country_date
  ON "ProviderDailyMetric" ("countryId", "date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_cdm_date
  ON "CountryDailyMetric" ("date");
