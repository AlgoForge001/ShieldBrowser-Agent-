/**
 * Vision Module — Public API
 *
 * Barrel export for all vision module components.
 */

// Module 1 — Visual PII Detector
export { buildDetectionReport, domBboxesToVisualBboxes, faceDetectionsToVisualBboxes, mergeAndDeduplicate } from './visualPiiDetector';
export type { VisualBbox, BboxType, FaceDetectionResult, PiiDetectionReport } from './visualPiiDetector';

// Module 1 — DOM Bbox Extractor
export { extractDomBboxes } from './domBboxExtractor';
export type { DomBbox } from './domBboxExtractor';

// Module 1 — Face Detector
export { detectFaces } from './faceDetector';
export type { FaceBox } from './faceDetector';

// Module 2 — Visual Redactor
export { redactScreenshot } from './visualRedactor';
export type { RedactionResult, RedactionReport } from './visualRedactor';

export { sanitizeScreenshot } from './sanitizeScreenshot';
export type { SanitizeScreenshotOptions, SanitizeScreenshotResult } from './sanitizeScreenshot';

// Module 4 — Pipeline Orchestrator
export { VisionPipeline } from './pipeline';
export type { PipelineResult, PipelineOptions } from './pipeline';

// Module 5 — Screen Classifier (CLIP zero-shot + heuristic)
export { classifyScreen } from './screenClassifier';
export { heuristicClassify, labelToPrivacyLevel } from './heuristicClassifier';
export type { ClassificationResult, PrivacyLevel, ClassificationSource } from './heuristicClassifier';

