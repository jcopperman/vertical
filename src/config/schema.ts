/**
 * Joi validation schemas for OTP CLI configuration
 */

import Joi from 'joi';
import { ProfileType } from './types';

// Profile type schema
const profileSchema = Joi.string().valid('local', 'ci', 'k8s').required();

// Auth configuration schema
const authConfigSchema = Joi.object({
  type: Joi.string().valid('basic', 'token', 'oauth').required(),
  username: Joi.string().when('type', {
    is: 'basic',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  password: Joi.string().when('type', {
    is: 'basic',
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  token: Joi.string().when('type', {
    is: 'token',
    then: Joi.required(),
    otherwise: Joi.optional()
  })
});

// Service definition schema
const serviceDefinitionSchema = Joi.object({
  name: Joi.string().required(),
  ports: Joi.array().items(Joi.number().port()).required(),
  healthCheck: Joi.object({
    endpoint: Joi.string().uri({ relativeOnly: true }).required(),
    timeout: Joi.number().positive().default(30),
    retries: Joi.number().integer().min(0).default(3)
  }).optional(),
  dependencies: Joi.array().items(Joi.string()).optional()
});

// Health check configuration schema
const healthCheckConfigSchema = Joi.object({
  timeout: Joi.number().positive().default(60),
  retries: Joi.number().integer().min(0).default(5),
  interval: Joi.number().positive().default(5)
});

// Compose configuration schema
const composeConfigSchema = Joi.object({
  baseFile: Joi.string().required(),
  profileFiles: Joi.object({
    local: Joi.string().required(),
    ci: Joi.string().required(),
    k8s: Joi.string().required()
  }).required(),
  projectName: Joi.string().required()
});

// Helm configuration schema
const helmConfigSchema = Joi.object({
  chart: Joi.string().required(),
  namespace: Joi.string().required(),
  values: Joi.object().default({})
});

// Infrastructure configuration schema
const infrastructureConfigSchema = Joi.object({
  compose: composeConfigSchema.required(),
  helm: helmConfigSchema.optional(),
  services: Joi.array().items(serviceDefinitionSchema).required(),
  healthChecks: healthCheckConfigSchema.required()
});

// Runner definition schema
const runnerDefinitionSchema = Joi.object({
  type: Joi.string().valid('docker', 'k8s', 'local').required(),
  image: Joi.string().when('type', {
    is: Joi.valid('docker', 'k8s'),
    then: Joi.required(),
    otherwise: Joi.optional()
  }),
  command: Joi.array().items(Joi.string()).required(),
  environment: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
  volumes: Joi.array().items(Joi.string()).optional(),
  timeout: Joi.number().positive().default(300)
});

// Dashboard configuration schema
const dashboardConfigSchema = Joi.object({
  name: Joi.string().required(),
  uid: Joi.string().required(),
  filters: Joi.object().pattern(Joi.string(), Joi.string()).optional()
});

// Grafana configuration schema
const grafanaConfigSchema = Joi.object({
  url: Joi.string().uri().required(),
  auth: authConfigSchema.optional(),
  dashboards: Joi.array().items(dashboardConfigSchema).required()
});

// Results API configuration schema
const resultsApiConfigSchema = Joi.object({
  url: Joi.string().uri().required(),
  timeout: Joi.number().positive().default(30),
  auth: authConfigSchema.optional()
});

// Reporting configuration schema
const reportingConfigSchema = Joi.object({
  grafana: grafanaConfigSchema.required(),
  resultsApi: resultsApiConfigSchema.required()
});

// Fixture set schema
const fixtureSetSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required(),
  files: Joi.array().items(Joi.string()).required(),
  dependencies: Joi.array().items(Joi.string()).optional()
});

// Fixture configuration schema
const fixtureConfigSchema = Joi.object({
  defaultSet: Joi.string().required(),
  sets: Joi.object().pattern(Joi.string(), fixtureSetSchema).min(1).required()
});

// Main OTP configuration schema
export const otpConfigSchema = Joi.object({
  version: Joi.string().required(),
  profile: profileSchema,
  infrastructure: infrastructureConfigSchema.required(),
  runners: Joi.object().pattern(Joi.string(), runnerDefinitionSchema).required(),
  reporting: reportingConfigSchema.required(),
  fixtures: fixtureConfigSchema.required()
});

// Export individual schemas for testing
export {
  profileSchema,
  authConfigSchema,
  serviceDefinitionSchema,
  healthCheckConfigSchema,
  composeConfigSchema,
  helmConfigSchema,
  infrastructureConfigSchema,
  runnerDefinitionSchema,
  dashboardConfigSchema,
  grafanaConfigSchema,
  resultsApiConfigSchema,
  reportingConfigSchema,
  fixtureSetSchema,
  fixtureConfigSchema
};