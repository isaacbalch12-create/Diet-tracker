/** Shared (client + server) shapes for AI meal drafts awaiting the user's review. */
import type { MealItemInput } from "./validation";

export interface DraftItem extends MealItemInput {
  /** Stable client-side key for editing. */
  key: string;
}

export interface DraftQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface MealDraft {
  title: string;
  suggestedCategory: string | null;
  items: DraftItem[];
  questions: DraftQuestion[];
  /** Model-written explanation of what is uncertain (portions, oils, hidden ingredients…). */
  uncertaintyNotes: string | null;
  isFood: boolean;
  model: string;
}

export interface AnalysisView {
  id: string;
  requestId: string;
  status: "pending" | "completed" | "failed" | "confirmed" | "discarded";
  inputType: "text" | "photo";
  inputText: string | null;
  imageIds: string[];
  draft: MealDraft | null;
  answers: { question: string; answer: string }[];
  error: string | null;
  mealId: string | null;
  createdAt: string;
}
