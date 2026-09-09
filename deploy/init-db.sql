-- Ayus production DB bootstrap (run ONCE on a fresh DB). Full schema from
-- prisma/schema.prisma + the pgvector store. deploy.sh then marks existing
-- migrations applied so future 'prisma migrate deploy' runs only new ones.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "FileStatus" AS ENUM ('UPLOADED', 'PROCESSING', 'READY', 'NEEDS_REVIEW', 'CONFIRMED', 'ERROR');

-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('MARKDOWN', 'TEXT', 'PDF', 'IMAGE', 'CSV', 'JSON');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('INGEST', 'REINDEX', 'AUTO_TAG', 'AUTO_LINK', 'EXTRACT', 'WIKI_GENERATE', 'LINT');

-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('LAB_REPORT', 'PRESCRIPTION', 'DISCHARGE_SUMMARY', 'DOCTOR_NOTE', 'HEALTH_NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "DateSource" AS ENUM ('SAMPLE_COLLECTED', 'REPORT_DATE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ValueOperator" AS ENUM ('LT', 'GT', 'EQ', 'APPROX');

-- CreateEnum
CREATE TYPE "Interpretation" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('INDIVIDUAL', 'CLINIC', 'DIAGNOSTIC_CENTER', 'HOSPITAL', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'PERSONAL', 'FAMILY', 'CLINIC_STARTER', 'DIAGNOSTIC_CENTER', 'HOSPITAL_SITE', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF', 'PATIENT');

-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OLLAMA_LOCAL', 'VLLM', 'LLAMACPP', 'GEMINI', 'OPENAI', 'CLAUDE', 'AZURE_OPENAI', 'BEDROCK', 'VERTEX');

-- CreateEnum
CREATE TYPE "FeedbackType" AS ENUM ('FEATURE', 'PROBLEM', 'OTHER');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'PLANNED', 'RESOLVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "Specialty" AS ENUM ('GENERAL', 'CARDIOLOGY', 'ENDOCRINOLOGY', 'GASTROENTEROLOGY', 'NEPHROLOGY', 'NEUROLOGY', 'ONCOLOGY', 'OPHTHALMOLOGY', 'ORTHOPEDICS', 'PULMONOLOGY', 'DERMATOLOGY', 'UROLOGY', 'GYNECOLOGY', 'PSYCHIATRY', 'ENT', 'DENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "MedFrequency" AS ENUM ('ONCE_DAILY', 'TWICE_DAILY', 'THRICE_DAILY', 'FOUR_TIMES_DAILY', 'AS_NEEDED', 'WEEKLY', 'ALTERNATE_DAYS');

-- CreateEnum
CREATE TYPE "MealType" AS ENUM ('BREAKFAST', 'MORNING_SNACK', 'LUNCH', 'AFTERNOON_SNACK', 'DINNER', 'EVENING_SNACK');

-- CreateEnum
CREATE TYPE "RuleOperator" AS ENUM ('GT', 'GTE', 'LT', 'LTE', 'BETWEEN', 'OUTSIDE_RANGE');

-- CreateEnum
CREATE TYPE "RuleSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('INFO', 'WARN', 'URGENT');

-- CreateEnum
CREATE TYPE "AlertStatus" AS ENUM ('NEW', 'SEEN', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ShareResource" AS ENUM ('EMERGENCY_CARD', 'VISIT_PREP', 'REPORT', 'FULL_WIKI', 'DOCTOR_NOTE');

-- CreateEnum
CREATE TYPE "ClinicalReportKind" AS ENUM ('IMAGING', 'ECG', 'ECHO', 'BIOPSY', 'DISCHARGE_SUMMARY', 'PRESCRIPTION', 'CONSULTATION', 'VACCINATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportSeverity" AS ENUM ('NORMAL', 'MINOR', 'MODERATE', 'SEVERE', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'ACCEPTED', 'COMPLETED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('PENDING', 'GRANTED', 'REVOKED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "phoneVerified" TIMESTAMP(3),
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT true,
    "name" TEXT,
    "passwordHash" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "healthMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dateOfBirth" TIMESTAMP(3),
    "bloodType" TEXT,
    "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "chronicConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "emergencyContactRelation" TEXT,
    "aiProvider" "AiProvider",
    "aiModel" TEXT,
    "byokKeyEncrypted" TEXT,
    "vllmBaseUrl" TEXT,
    "llamaCppBaseUrl" TEXT,
    "privacyMode" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Feedback" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT,
    "accountKind" TEXT NOT NULL,
    "type" "FeedbackType" NOT NULL DEFAULT 'OTHER',
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "contactEmail" TEXT,
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "PhoneOtp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhoneOtp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadType" "UploadType" NOT NULL DEFAULT 'OTHER',
    "status" "FileStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT,
    "uploadedById" TEXT,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docType" "DocType" NOT NULL,
    "rawContent" TEXT NOT NULL,
    "renderedHtml" TEXT,
    "summary" TEXT,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "frontmatter" JSONB,
    "aliases" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aiSuggested" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTag" (
    "documentId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "DocumentTag_pkey" PRIMARY KEY ("documentId","tagId")
);

-- CreateTable
CREATE TABLE "WikiLink" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT,
    "targetSlug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WikiLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Collection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectionDocument" (
    "collectionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectionDocument_pkey" PRIMARY KEY ("collectionId","documentId")
);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "charStart" INTEGER NOT NULL,
    "charEnd" INTEGER NOT NULL,
    "embedded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "doctorName" TEXT NOT NULL,
    "specialty" "Specialty" NOT NULL DEFAULT 'GENERAL',
    "clinic" TEXT,
    "diagnosis" TEXT,
    "notes" TEXT,
    "followUpDate" TIMESTAMP(3),
    "documentId" TEXT,
    "organizationId" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL,
    "doctorNoteId" TEXT NOT NULL,
    "medication" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "duration" TEXT,
    "instructions" TEXT,

    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Medication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" "MedFrequency" NOT NULL DEFAULT 'ONCE_DAILY',
    "timeSlots" TEXT[],
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Medication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mealType" "MealType" NOT NULL,
    "time" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "calories" INTEGER,
    "notes" TEXT,
    "restrictions" TEXT[],
    "daysOfWeek" INTEGER[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "cuisine_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prep_minutes" INTEGER,
    "recipe_url" TEXT,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "sampleCollectedOn" TIMESTAMP(3),
    "dateSource" "DateSource" NOT NULL DEFAULT 'UNKNOWN',
    "referredBy" TEXT,
    "sampleType" TEXT,
    "rawJson" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "rawTestName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "canonicalTestId" TEXT,
    "loinc_num" TEXT,
    "observedValueRaw" TEXT NOT NULL,
    "observedValueNumeric" DOUBLE PRECISION,
    "observedValueOperator" "ValueOperator",
    "observedValueUnit" TEXT,
    "referenceIntervalRaw" TEXT,
    "referenceLow" DOUBLE PRECISION,
    "referenceHigh" DOUBLE PRECISION,
    "referenceUnit" TEXT,
    "interpretation" "Interpretation" NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL,
    "isOutOfRange" BOOLEAN NOT NULL,
    "plausibilityFlag" VARCHAR(30),
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_page" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCanonical" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "specimen" VARCHAR(50),
    "minValue" DOUBLE PRECISION,
    "maxValue" DOUBLE PRECISION,
    "expectedUnit" VARCHAR(50),
    "loinc_num" TEXT,
    "test_purpose" TEXT,
    "high_interpretation" TEXT,
    "low_interpretation" TEXT,
    "clinical_use" TEXT,
    "related_diseases" TEXT,

    CONSTRAINT "TestCanonical_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestSynonym" (
    "id" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "canonicalTestId" TEXT NOT NULL,

    CONSTRAINT "TestSynonym_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganSystem" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "svgRegionId" TEXT NOT NULL,

    CONSTRAINT "OrganSystem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganSystemTestMap" (
    "organSystemId" TEXT NOT NULL,
    "canonicalTestId" TEXT NOT NULL,

    CONSTRAINT "OrganSystemTestMap_pkey" PRIMARY KEY ("organSystemId","canonicalTestId")
);

-- CreateTable
CREATE TABLE "loinc_terms" (
    "loinc_num" TEXT NOT NULL,
    "name" TEXT,
    "component" TEXT,
    "system" TEXT,
    "units" TEXT,
    "display_name" TEXT,
    "consumer_name" TEXT,

    CONSTRAINT "loinc_terms_pkey" PRIMARY KEY ("loinc_num")
);

-- CreateTable
CREATE TABLE "UnresolvedTestName" (
    "id" TEXT NOT NULL,
    "rawName" TEXT NOT NULL,
    "normalizedForm" TEXT NOT NULL,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "lastSampleUserId" TEXT,
    "lastSampleReportId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnresolvedTestName_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diseases" (
    "id" TEXT NOT NULL,
    "icd10_code" TEXT,
    "icd10_name" TEXT,
    "common_name" TEXT NOT NULL,
    "category" TEXT,
    "description" TEXT,
    "organ_system_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "diseases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "canonical_test_id" TEXT NOT NULL,
    "operator" "RuleOperator" NOT NULL,
    "threshold_low" DOUBLE PRECISION,
    "threshold_high" DOUBLE PRECISION,
    "unit" VARCHAR(50),
    "severity" "RuleSeverity" NOT NULL,
    "suggestion" TEXT NOT NULL,
    "disclaimer" TEXT NOT NULL DEFAULT 'This is informational only. Not a medical diagnosis. Consult a qualified physician before acting on this result.',
    "disease_id" TEXT,
    "source" TEXT,
    "source_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "kind" "ClinicalReportKind" NOT NULL,
    "modality" TEXT,
    "bodyPart" TEXT,
    "procedureName" TEXT,
    "performedOn" TIMESTAMP(3),
    "referringDoctor" TEXT,
    "performedBy" TEXT,
    "institution" TEXT,
    "indication" TEXT,
    "technique" TEXT,
    "findings" TEXT,
    "impression" TEXT,
    "recommendations" TEXT,
    "measurements" JSONB,
    "abnormalFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "severity" "ReportSeverity",
    "rawJson" JSONB,
    "bio_entities" JSONB,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resource" "ShareResource" NOT NULL,
    "resourceId" TEXT,
    "snapshotJson" JSONB,
    "pinHash" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "maxViews" INTEGER,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiomarkerAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "testResultId" TEXT,
    "normalizedName" TEXT NOT NULL,
    "severity" "AlertSeverity" NOT NULL DEFAULT 'WARN',
    "status" "AlertStatus" NOT NULL DEFAULT 'NEW',
    "title" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "observedValue" TEXT,
    "previousValue" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),

    CONSTRAINT "BiomarkerAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "type" "OrgType" NOT NULL DEFAULT 'INDIVIDUAL',
    "gstin" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "dataRegion" TEXT NOT NULL DEFAULT 'ap-south-1',
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "defaultAiProvider" "AiProvider" NOT NULL DEFAULT 'OLLAMA_LOCAL',
    "defaultAiModel" TEXT NOT NULL DEFAULT '',
    "byokKeyEncrypted" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "fromOrgId" TEXT NOT NULL,
    "toOrgId" TEXT,
    "toOrgName" TEXT,
    "specialty" "Specialty" NOT NULL DEFAULT 'GENERAL',
    "reason" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatientLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "PatientLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'PATIENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "reportsPerMonth" INTEGER NOT NULL,
    "reportsUsed" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "trialEndsAt" TIMESTAMP(3),
    "byokEnabled" BOOLEAN NOT NULL DEFAULT false,
    "razorpayPlanId" TEXT,
    "razorpaySubId" TEXT,
    "razorpayCustId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "provider" "AiProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,8) NOT NULL,
    "costInr" DECIMAL(12,4) NOT NULL,
    "reportId" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "Feedback_createdAt_idx" ON "Feedback"("createdAt");

-- CreateIndex
CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE INDEX "PhoneOtp_phone_createdAt_idx" ON "PhoneOtp"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "Upload_organizationId_createdAt_idx" ON "Upload"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Upload_userId_sha256_key" ON "Upload"("userId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Document_uploadId_key" ON "Document"("uploadId");

-- CreateIndex
CREATE INDEX "Document_userId_updatedAt_idx" ON "Document"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Document_userId_slug_key" ON "Document"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "WikiLink_sourceId_idx" ON "WikiLink"("sourceId");

-- CreateIndex
CREATE INDEX "WikiLink_targetId_idx" ON "WikiLink"("targetId");

-- CreateIndex
CREATE INDEX "WikiLink_targetSlug_idx" ON "WikiLink"("targetSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Collection_userId_name_key" ON "Collection"("userId", "name");

-- CreateIndex
CREATE INDEX "Chunk_documentId_index_idx" ON "Chunk"("documentId", "index");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DoctorNote_documentId_key" ON "DoctorNote"("documentId");

-- CreateIndex
CREATE INDEX "DoctorNote_userId_visitDate_idx" ON "DoctorNote"("userId", "visitDate");

-- CreateIndex
CREATE INDEX "DoctorNote_organizationId_visitDate_idx" ON "DoctorNote"("organizationId", "visitDate");

-- CreateIndex
CREATE INDEX "Medication_userId_active_idx" ON "Medication"("userId", "active");

-- CreateIndex
CREATE INDEX "DietSchedule_userId_active_idx" ON "DietSchedule"("userId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Report_uploadId_key" ON "Report"("uploadId");

-- CreateIndex
CREATE INDEX "Report_userId_sampleCollectedOn_idx" ON "Report"("userId", "sampleCollectedOn");

-- CreateIndex
CREATE INDEX "Report_organizationId_createdAt_idx" ON "Report"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "TestResult_userId_normalizedName_createdAt_idx" ON "TestResult"("userId", "normalizedName", "createdAt");

-- CreateIndex
CREATE INDEX "TestResult_canonicalTestId_createdAt_idx" ON "TestResult"("canonicalTestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestCanonical_name_key" ON "TestCanonical"("name");

-- CreateIndex
CREATE INDEX "TestCanonical_loinc_num_idx" ON "TestCanonical"("loinc_num");

-- CreateIndex
CREATE UNIQUE INDEX "TestSynonym_rawName_key" ON "TestSynonym"("rawName");

-- CreateIndex
CREATE UNIQUE INDEX "OrganSystem_key_key" ON "OrganSystem"("key");

-- CreateIndex
CREATE UNIQUE INDEX "UnresolvedTestName_rawName_key" ON "UnresolvedTestName"("rawName");

-- CreateIndex
CREATE INDEX "UnresolvedTestName_status_seenCount_idx" ON "UnresolvedTestName"("status", "seenCount");

-- CreateIndex
CREATE INDEX "UnresolvedTestName_normalizedForm_idx" ON "UnresolvedTestName"("normalizedForm");

-- CreateIndex
CREATE UNIQUE INDEX "diseases_icd10_code_key" ON "diseases"("icd10_code");

-- CreateIndex
CREATE INDEX "diseases_category_idx" ON "diseases"("category");

-- CreateIndex
CREATE INDEX "diseases_organ_system_id_idx" ON "diseases"("organ_system_id");

-- CreateIndex
CREATE INDEX "rules_canonical_test_id_is_active_idx" ON "rules"("canonical_test_id", "is_active");

-- CreateIndex
CREATE INDEX "rules_disease_id_idx" ON "rules"("disease_id");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalReport_uploadId_key" ON "ClinicalReport"("uploadId");

-- CreateIndex
CREATE INDEX "ClinicalReport_userId_kind_performedOn_idx" ON "ClinicalReport"("userId", "kind", "performedOn");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX "ShareLink_userId_createdAt_idx" ON "ShareLink"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "BiomarkerAlert_userId_status_createdAt_idx" ON "BiomarkerAlert"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BiomarkerAlert_userId_normalizedName_idx" ON "BiomarkerAlert"("userId", "normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "Referral_fromOrgId_createdAt_idx" ON "Referral"("fromOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "Referral_toOrgId_status_idx" ON "Referral"("toOrgId", "status");

-- CreateIndex
CREATE INDEX "Referral_patientId_idx" ON "Referral"("patientId");

-- CreateIndex
CREATE INDEX "PatientLink_patientId_status_idx" ON "PatientLink"("patientId", "status");

-- CreateIndex
CREATE INDEX "PatientLink_organizationId_status_idx" ON "PatientLink"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PatientLink_organizationId_patientId_key" ON "PatientLink"("organizationId", "patientId");

-- CreateIndex
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationMember_organizationId_userId_key" ON "OrganizationMember"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_organizationId_idx" ON "ApiKey"("organizationId");

-- CreateIndex
CREATE INDEX "UsageEvent_organizationId_createdAt_idx" ON "UsageEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_event_createdAt_idx" ON "UsageEvent"("event", "createdAt");

-- AddForeignKey
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTag" ADD CONSTRAINT "DocumentTag_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTag" ADD CONSTRAINT "DocumentTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiLink" ADD CONSTRAINT "WikiLink_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WikiLink" ADD CONSTRAINT "WikiLink_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Collection" ADD CONSTRAINT "Collection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDocument" ADD CONSTRAINT "CollectionDocument_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "Collection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectionDocument" ADD CONSTRAINT "CollectionDocument_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorNote" ADD CONSTRAINT "DoctorNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorNote" ADD CONSTRAINT "DoctorNote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorNote" ADD CONSTRAINT "DoctorNote_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_doctorNoteId_fkey" FOREIGN KEY ("doctorNoteId") REFERENCES "DoctorNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Medication" ADD CONSTRAINT "Medication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DietSchedule" ADD CONSTRAINT "DietSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_canonicalTestId_fkey" FOREIGN KEY ("canonicalTestId") REFERENCES "TestCanonical"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCanonical" ADD CONSTRAINT "TestCanonical_loinc_num_fkey" FOREIGN KEY ("loinc_num") REFERENCES "loinc_terms"("loinc_num") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSynonym" ADD CONSTRAINT "TestSynonym_canonicalTestId_fkey" FOREIGN KEY ("canonicalTestId") REFERENCES "TestCanonical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganSystemTestMap" ADD CONSTRAINT "OrganSystemTestMap_organSystemId_fkey" FOREIGN KEY ("organSystemId") REFERENCES "OrganSystem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganSystemTestMap" ADD CONSTRAINT "OrganSystemTestMap_canonicalTestId_fkey" FOREIGN KEY ("canonicalTestId") REFERENCES "TestCanonical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diseases" ADD CONSTRAINT "diseases_organ_system_id_fkey" FOREIGN KEY ("organ_system_id") REFERENCES "OrganSystem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_canonical_test_id_fkey" FOREIGN KEY ("canonical_test_id") REFERENCES "TestCanonical"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rules" ADD CONSTRAINT "rules_disease_id_fkey" FOREIGN KEY ("disease_id") REFERENCES "diseases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReport" ADD CONSTRAINT "ClinicalReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalReport" ADD CONSTRAINT "ClinicalReport_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_fromOrgId_fkey" FOREIGN KEY ("fromOrgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_toOrgId_fkey" FOREIGN KEY ("toOrgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLink" ADD CONSTRAINT "PatientLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatientLink" ADD CONSTRAINT "PatientLink_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- pgvector store (kept outside Prisma):
-- Enable the pgvector extension. Requires `brew install pgvector` (or the
-- distro equivalent) at the OS level before this migration will succeed.
CREATE EXTENSION IF NOT EXISTS vector;

-- Vector storage table. Kept out of the Prisma model layer because Prisma
-- doesn't type-check vector operations; all access goes via $queryRaw /
-- $executeRaw from src/lib/ai/pgvector-store.ts.
--
-- Embedding dimension is 768 (nomic-embed-text via Ollama, the default in
-- src/lib/ai/ollama-embed.ts). If you switch embed models, drop and recreate
-- this table with the new dimension.
CREATE TABLE "VectorEntry" (
  "id"        TEXT PRIMARY KEY,
  "namespace" TEXT NOT NULL,
  "text"      TEXT NOT NULL,
  "metadata"  JSONB NOT NULL DEFAULT '{}'::jsonb,
  "embedding" vector(768) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "VectorEntry_namespace_idx" ON "VectorEntry" ("namespace");

-- HNSW index for cosine-similarity search (matches the search() operator `<=>`
-- with vector_cosine_ops). Built at CREATE-time when the table is empty; will
-- be maintained incrementally as rows are upserted.
CREATE INDEX "VectorEntry_embedding_idx"
  ON "VectorEntry"
  USING hnsw ("embedding" vector_cosine_ops);
