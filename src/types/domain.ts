export type Id = string;
export type IsoDateTime = string;
export type IsoDate = string;
export type Score = number;

export interface EntityMeta {
  id: Id;
  schemaVersion: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Result<T, E = string> {
  ok: boolean;
  value?: T;
  error?: E;
}

export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'true_false'
  | 'fill_blank'
  | 'short_answer'
  | 'case_analysis'
  | 'essay';

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type Importance = 1 | 2 | 3 | 4 | 5;

export interface SubjectConfig {
  id: Id;
  name: string;
  code?: string;
  questionTypes: QuestionType[];
  defaultDurationMinutes: number;
  defaultTotalPoints: number;
  order: number;
}

export interface ChapterConfig {
  id: Id;
  subjectId: Id;
  parentId?: Id;
  name: string;
  order: number;
  sourceNotePath?: string;
}

export interface SyllabusNode {
  id: Id;
  subjectId: Id;
  parentId?: Id;
  name: string;
  order: number;
  description?: string;
}

export interface ExamConfig extends EntityMeta {
  name: string;
  description?: string;
  subjects: SubjectConfig[];
  chapters: ChapterConfig[];
  syllabus: SyllabusNode[];
  defaultPaperConfig?: Partial<PaperConfig>;
}

export type SourceType =
  | 'real_exam'
  | 'manual'
  | 'sample'
  | 'ai_generated'
  | 'wrong_derived'
  | 'knowledge_point_drill';

export type SourceNature =
  | 'official'
  | 'institution'
  | 'recall'
  | 'community'
  | 'unknown';

export type ReviewStatus = 'draft' | 'pending_review' | 'approved' | 'rejected';

export type GenerationMethod = 'manual' | 'rule' | 'ai' | 'import' | 'derived';

export interface SourceRef {
  type: SourceType;
  nature: SourceNature;
  title?: string;
  examYear?: number;
  examSession?: string;
  paperName?: string;
  questionNo?: string;
  page?: number;
  url?: string;
  notePath?: string;
  note?: string;
}

export interface QuestionOption {
  key: string;
  text: string;
}

export interface FillBlankAnswer {
  accepted: string[];
}

export type QuestionAnswer =
  | { kind: 'single_choice'; optionKey: string }
  | { kind: 'multiple_choice'; optionKeys: string[] }
  | { kind: 'true_false'; value: boolean }
  | { kind: 'fill_blank'; blanks: FillBlankAnswer[] }
  | { kind: 'subjective'; referenceAnswer: string; rubric: RubricItem[] };

export interface RubricItem {
  id: Id;
  description: string;
  points: number;
  requiredPoints?: string[];
}

export interface FillBlankPolicy {
  trim: boolean;
  normalizeFullWidth: boolean;
  normalizePunctuation: boolean;
  caseSensitive: boolean;
  perBlankPartial: boolean;
}

export interface ScoringRule {
  points: number;
  multiSelectPolicy: 'all_or_nothing' | 'partial';
  fillBlankPolicy: FillBlankPolicy;
  manualOverrideAllowed: boolean;
}

export interface Question extends EntityMeta {
  type: QuestionType;
  stem: string;
  options?: QuestionOption[];
  answer: QuestionAnswer;
  explanation?: string;
  scoringRule: ScoringRule;
  difficulty: Difficulty;
  examId: Id;
  subjectId: Id;
  chapterIds: Id[];
  syllabusNodeIds: Id[];
  knowledgePointIds: Id[];
  source: SourceRef;
  generationMethod: GenerationMethod;
  reviewStatus: ReviewStatus;
  tags: string[];
  version: number;
  duplicateOf?: Id;
  extra?: Record<string, unknown>;
}

export interface QuestionBank extends EntityMeta {
  name: string;
  examId: Id;
  subjectId: Id;
  questions: Question[];
}

export type PaperMode =
  | 'real' | 'ai' | 'mixed'
  | 'syllabus_mock'
  | 'chapter_drill'
  | 'real_exam_mock'
  | 'wrong_question_drill'
  | 'forgotten_kp_review'
  | 'important_kp_drill'
  | 'adaptive';

export interface PaperConfig {
  examId: Id;
  subjectIds: Id[];
  mode: PaperMode;
  chapterIds?: Id[];
  syllabusNodeIds?: Id[];
  knowledgePointIds?: Id[];
  questionCounts: Partial<Record<QuestionType, number>>;
  difficultyCounts?: Partial<Record<Difficulty, number>>;
  sourceTypes?: SourceType[];
  sourceNatures?: SourceNature[];
  examYears?: number[];
  examSessions?: string[];
  reviewStatuses?: ReviewStatus[];
  totalPointsTarget?: number;
  durationMinutes: number;
  excludeRecentPapers: number;
  allowRepeatWithinPaper: boolean;
  seed?: number;
  aiSupplement?: boolean;
  aiQuestionCount?: number;
  instruction?: string;
}

export interface PaperItem {
  index: number;
  questionId: Id;
  questionVersion: number;
  snapshot: Question;
  points: number;
}

export interface Paper extends EntityMeta {
  title: string;
  examId: Id;
  subjectIds: Id[];
  mode: PaperMode;
  config: PaperConfig;
  seed: number;
  items: PaperItem[];
  totalPoints: number;
  durationMinutes: number;
  generationMethod: GenerationMethod;
  sourceAttemptId?: Id;
  notes?: string;
}

export type AttemptStatus = 'in_progress' | 'submitted' | 'graded' | 'abandoned';

export type ErrorReason =
  | 'kp_unmastered'
  | 'concept_confusion'
  | 'weak_memory'
  | 'misread'
  | 'application_gap'
  | 'other';

export interface UserAnswer {
  subAnswers?: Record<Id, string>;
  kind: 'single_choice' | 'multiple_choice' | 'true_false' | 'fill_blank' | 'subjective';
  optionKey?: string;
  optionKeys?: string[];
  value?: boolean;
  blanks?: string[];
  text?: string;
}

export interface AnswerRecord {
  questionId: Id;
  answer: UserAnswer | null;
  flagged: boolean;
  updatedAt: IsoDateTime;
  timeSpentSeconds: number;
  errorReasons?: ErrorReason[];
  note?: string;
}

export interface ManualAdjustment {
  id: Id;
  questionId?: Id;
  originalPoints: number;
  adjustedPoints: number;
  reason: string;
  adjustedAt: IsoDateTime;
}

export interface QuestionScore {
  questionId: Id;
  index: number;
  points: number;
  earnedPoints: number;
  correct: boolean | 'partial';
  detail: string;
  matchedPoints?: string[];
  missingPoints?: string[];
  manualAdjusted?: boolean;
}

export interface AttemptScore {
  totalPoints: number;
  earnedPoints: number;
  accuracy: number;
  perQuestion: QuestionScore[];
  manualAdjustments: ManualAdjustment[];
  gradedAt: IsoDateTime;
}

export interface KpPerformance {
  knowledgePointId: Id;
  questionCount: number;
  correctCount: number;
  earnedPoints: number;
  totalPoints: number;
}

export interface AttemptReport {
  score: AttemptScore;
  byKnowledgePoint: KpPerformance[];
  byChapter: KpPerformance[];
  byType: {
    type: QuestionType;
    questionCount: number;
    correctCount: number;
    earnedPoints: number;
    totalPoints: number;
  }[];
  weakKnowledgePointIds: Id[];
  errorReasonCounts: Partial<Record<ErrorReason, number>>;
  recommendations: string[];
  nextPaperSuggestion?: Partial<PaperConfig>;
  generatedAt: IsoDateTime;
}

export interface Attempt extends EntityMeta {
  paperId: Id;
  paperTitle: string;
  paperMode: PaperMode;
  paperHash: string;
  examId: Id;
  subjectIds: Id[];
  status: AttemptStatus;
  startedAt: IsoDateTime;
  deadlineAt: IsoDateTime;
  submittedAt?: IsoDateTime;
  autoSubmitted?: boolean;
  answers: Record<Id, AnswerRecord>;
  activeQuestionIndex: number;
  score?: AttemptScore;
  report?: AttemptReport;
}

export interface KnowledgePoint extends EntityMeta {
  name: string;
  examId: Id;
  subjectId: Id;
  chapterIds: Id[];
  syllabusNodeIds: Id[];
  importance: Importance;
  selfRating?: 1 | 2 | 3 | 4 | 5;
  definition?: string;
  relatedNotePaths: string[];
  tags: string[];
}

export interface OutcomeSample {
  at: IsoDateTime;
  scoreRatio: number;
  difficulty: Difficulty;
  timeSpentSeconds?: number;
}

export interface ReviewState {
  ease: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueAt: IsoDate;
  lastReviewedAt?: IsoDateTime;
  lastQuality?: 0 | 1 | 2 | 3 | 4 | 5;
}

export interface KnowledgePointProgress {
  knowledgePointId: Id;
  mastery: number;
  recentOutcomes: OutcomeSample[];
  review: ReviewState;
  updatedAt: IsoDateTime;
}

export interface WrongQuestionStatus {
  errorReasons?: ErrorReason[];
  questionId: Id;
  mastered: boolean;
  masteredAt?: IsoDateTime;
  note?: string;
  updatedAt: IsoDateTime;
}

export interface WrongQuestionEntry {
  questionId: Id;
  question?: Question;
  wrongCount: number;
  lastWrongAt: IsoDateTime;
  lastResult: 'wrong' | 'correct' | 'unanswered';
  attemptIds: Id[];
  errorReasons: ErrorReason[];
  mastered: boolean;
}

export interface LLMProviderSettings {
  provider: 'openai_compatible';
  baseUrl: string;
  model: string;
  apiKeyMode: 'session' | 'device';
  timeoutMs: number;
  maxRetries: number;
  concurrency: number;
  streaming: boolean;
  temperature: number;
  maxTokens: number;
  pricePerMillionInput?: number;
  pricePerMillionOutput?: number;
  currency?: string;
}

export interface ExamFlowSettings {
  schemaVersion: number;
  dataFolder: string;
  activeExamId?: Id;
  ui: {
    pageSize: number;
    defaultPage: 'home';
  };
  review: {
    dailyQuestionLimit: number;
    dueSoonDays: number;
  };
  privacy: {
    aiEnabled: boolean;
    consentAcknowledgedAt?: IsoDateTime;
    allowedMaterialPaths: string[];
  };
  llm: LLMProviderSettings;
  backup: {
    lastBackupAt?: IsoDateTime;
  };
}

export type ShortageDimension =
  | 'question_type'
  | 'difficulty'
  | 'chapter'
  | 'syllabus_node'
  | 'knowledge_point'
  | 'source_type'
  | 'source_nature'
  | 'exam_year'
  | 'total_points';

export interface ShortageReport {
  dimension: ShortageDimension;
  key: string;
  requested: number;
  available: number;
  message: string;
}

export interface PaperGenerationInput {
  config: PaperConfig;
  seed?: number;
  createdBy: 'user' | 'system';
}

export interface PaperGenerationResult {
  ok: boolean;
  paper?: Paper;
  shortage: ShortageReport[];
  warnings: string[];
  seed: number;
  usedAiSupplement: boolean;
}

export interface PaperGenerator {
  generate(input: PaperGenerationInput): Promise<PaperGenerationResult>;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'text' | 'json';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCost?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  usage?: TokenUsage;
  finishReason?: string;
  latencyMs: number;
}

export interface LLMProvider {
  readonly id: string;
  chat(request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  chatStream?(
    request: ChatRequest,
    signal: AbortSignal,
    onDelta: (delta: string) => void,
  ): Promise<ChatResponse>;
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export interface MaterialChunk {
  id: string;
  sourcePath: string;
  page?: number;
  heading?: string;
  text: string;
  approxTokens: number;
  updatedAt: IsoDateTime;
}

export interface RetrievalResult {
  chunk: MaterialChunk;
  score: number;
}

export interface MaterialIndex {
  rebuild(paths: string[]): Promise<void>;
  updateChanged(paths: string[]): Promise<void>;
  search(query: string, topK: number, paths?: string[]): Promise<RetrievalResult[]>;
  removeSource(path: string): Promise<void>;
}
