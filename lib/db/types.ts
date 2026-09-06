export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.17"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_calls: {
        Row: {
          cost_usd: number | null
          error: string | null
          id: number
          input_tokens: number | null
          latency_ms: number | null
          model: string
          occurred_at: string
          output_tokens: number | null
          prompt_hash: string | null
          purpose: string
          success: boolean
        }
        Insert: {
          cost_usd?: number | null
          error?: string | null
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model: string
          occurred_at?: string
          output_tokens?: number | null
          prompt_hash?: string | null
          purpose: string
          success?: boolean
        }
        Update: {
          cost_usd?: number | null
          error?: string | null
          id?: number
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string
          occurred_at?: string
          output_tokens?: number | null
          prompt_hash?: string | null
          purpose?: string
          success?: boolean
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          actor_team: Database["public"]["Enums"]["team_role"] | null
          entity_id: string
          entity_type: string
          from_status: string | null
          id: number
          metadata: Json
          occurred_at: string
          reason: string | null
          to_status: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_team?: Database["public"]["Enums"]["team_role"] | null
          entity_id: string
          entity_type: string
          from_status?: string | null
          id?: number
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          to_status?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_team?: Database["public"]["Enums"]["team_role"] | null
          entity_id?: string
          entity_type?: string
          from_status?: string | null
          id?: number
          metadata?: Json
          occurred_at?: string
          reason?: string | null
          to_status?: string | null
        }
        Relationships: []
      }
      rate_limit_hit: {
        Row: {
          bucket: string
          occurred_at: string
        }
        Insert: {
          bucket: string
          occurred_at?: string
        }
        Update: {
          bucket?: string
          occurred_at?: string
        }
        Relationships: []
      }
      response_draft: {
        Row: {
          attachments_required: string[]
          citations: Json
          consideration_id: string
          created_at: string
          created_by: string | null
          deltas: Json
          draft_text: string | null
          groundedness: number | null
          id: string
          max_similarity: number | null
          model: string | null
          model_confidence: number | null
          open_questions: string[]
          precedent_ids: string[]
          prompt_hash: string | null
          refusal_reason: string | null
          refused: boolean
          verdicts: Json
        }
        Insert: {
          attachments_required?: string[]
          citations?: Json
          consideration_id: string
          created_at?: string
          created_by?: string | null
          deltas?: Json
          draft_text?: string | null
          groundedness?: number | null
          id?: string
          max_similarity?: number | null
          model?: string | null
          model_confidence?: number | null
          open_questions?: string[]
          precedent_ids?: string[]
          prompt_hash?: string | null
          refusal_reason?: string | null
          refused?: boolean
          verdicts?: Json
        }
        Update: {
          attachments_required?: string[]
          citations?: Json
          consideration_id?: string
          created_at?: string
          created_by?: string | null
          deltas?: Json
          draft_text?: string | null
          groundedness?: number | null
          id?: string
          max_similarity?: number | null
          model?: string | null
          model_confidence?: number | null
          open_questions?: string[]
          precedent_ids?: string[]
          prompt_hash?: string | null
          refusal_reason?: string | null
          refused?: boolean
          verdicts?: Json
        }
        Relationships: [
          {
            foreignKeyName: "response_draft_consideration_id_fkey"
            columns: ["consideration_id"]
            isOneToOne: false
            referencedRelation: "rfi_consideration"
            referencedColumns: ["id"]
          },
        ]
      }
      rfi_consideration: {
        Row: {
          category: string
          consideration_number: number
          consideration_text: string
          created_at: string
          document_id: string
          document_name: string | null
          fts: unknown
          id: string
          is_seed: boolean
          member_state: string | null
          outcome: Database["public"]["Enums"]["rfi_outcome"]
          owner_team: Database["public"]["Enums"]["team_role"] | null
          response_status: Database["public"]["Enums"]["response_status"]
          section: string
          section_part: Database["public"]["Enums"]["section_part"]
          source_page: number | null
          sponsor_response_text: string | null
          trial_id: string
          updated_at: string
        }
        Insert: {
          category: string
          consideration_number: number
          consideration_text: string
          created_at?: string
          document_id: string
          document_name?: string | null
          fts?: unknown
          id?: string
          is_seed?: boolean
          member_state?: string | null
          outcome?: Database["public"]["Enums"]["rfi_outcome"]
          owner_team?: Database["public"]["Enums"]["team_role"] | null
          response_status?: Database["public"]["Enums"]["response_status"]
          section: string
          section_part: Database["public"]["Enums"]["section_part"]
          source_page?: number | null
          sponsor_response_text?: string | null
          trial_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          consideration_number?: number
          consideration_text?: string
          created_at?: string
          document_id?: string
          document_name?: string | null
          fts?: unknown
          id?: string
          is_seed?: boolean
          member_state?: string | null
          outcome?: Database["public"]["Enums"]["rfi_outcome"]
          owner_team?: Database["public"]["Enums"]["team_role"] | null
          response_status?: Database["public"]["Enums"]["response_status"]
          section?: string
          section_part?: Database["public"]["Enums"]["section_part"]
          source_page?: number | null
          sponsor_response_text?: string | null
          trial_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfi_consideration_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "rfi_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfi_consideration_trial_id_fkey"
            columns: ["trial_id"]
            isOneToOne: false
            referencedRelation: "trial"
            referencedColumns: ["id"]
          },
        ]
      }
      rfi_document: {
        Row: {
          created_at: string
          document_ref: string
          due_at: string | null
          id: string
          issued_at: string
          page_count: number | null
          phase: Database["public"]["Enums"]["rfi_phase"]
          reporting_ms: string | null
          responded_at: string | null
          source_file_path: string | null
          submission_type: Database["public"]["Enums"]["submission_type"]
          trial_id: string
        }
        Insert: {
          created_at?: string
          document_ref: string
          due_at?: string | null
          id?: string
          issued_at: string
          page_count?: number | null
          phase: Database["public"]["Enums"]["rfi_phase"]
          reporting_ms?: string | null
          responded_at?: string | null
          source_file_path?: string | null
          submission_type: Database["public"]["Enums"]["submission_type"]
          trial_id: string
        }
        Update: {
          created_at?: string
          document_ref?: string
          due_at?: string | null
          id?: string
          issued_at?: string
          page_count?: number | null
          phase?: Database["public"]["Enums"]["rfi_phase"]
          reporting_ms?: string | null
          responded_at?: string | null
          source_file_path?: string | null
          submission_type?: Database["public"]["Enums"]["submission_type"]
          trial_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfi_document_trial_id_fkey"
            columns: ["trial_id"]
            isOneToOne: false
            referencedRelation: "trial"
            referencedColumns: ["id"]
          },
        ]
      }
      rfi_embedding: {
        Row: {
          consideration_id: string
          content: string
          embedding: string
          fts: unknown
          id: string
          kind: string
        }
        Insert: {
          consideration_id: string
          content: string
          embedding: string
          fts?: unknown
          id?: string
          kind: string
        }
        Update: {
          consideration_id?: string
          content?: string
          embedding?: string
          fts?: unknown
          id?: string
          kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfi_embedding_consideration_id_fkey"
            columns: ["consideration_id"]
            isOneToOne: false
            referencedRelation: "rfi_consideration"
            referencedColumns: ["id"]
          },
        ]
      }
      trial: {
        Row: {
          created_at: string
          eu_trial_number: string
          id: string
          imp_name: string | null
          member_states: string[]
          phase: string | null
          protocol_code: string | null
          short_title: string
          sponsor: string
          therapeutic_area: string | null
        }
        Insert: {
          created_at?: string
          eu_trial_number: string
          id?: string
          imp_name?: string | null
          member_states?: string[]
          phase?: string | null
          protocol_code?: string | null
          short_title: string
          sponsor?: string
          therapeutic_area?: string | null
        }
        Update: {
          created_at?: string
          eu_trial_number?: string
          id?: string
          imp_name?: string | null
          member_states?: string[]
          phase?: string | null
          protocol_code?: string | null
          short_title?: string
          sponsor?: string
          therapeutic_area?: string | null
        }
        Relationships: []
      }
      user_profile: {
        Row: {
          created_at: string
          full_name: string
          id: string
          member_state: string | null
          team: Database["public"]["Enums"]["team_role"]
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          member_state?: string | null
          team: Database["public"]["Enums"]["team_role"]
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          member_state?: string | null
          team?: Database["public"]["Enums"]["team_role"]
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      consume_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number }
        Returns: {
          allowed: boolean
          remaining: number
          retry_after_seconds: number
        }[]
      }
      current_team: {
        Args: never
        Returns: Database["public"]["Enums"]["team_role"]
      }
      lexical_precedents: {
        Args: {
          f_approved_only?: boolean
          f_part?: Database["public"]["Enums"]["section_part"]
          f_section?: string
          match_count?: number
          query_text: string
        }
        Returns: {
          consideration_id: string
          lexical_score: number
          matched_on: string
        }[]
      }
      mined_rules: {
        Args: {
          f_member_states?: string[]
          f_sections?: string[]
          f_submission_type?: Database["public"]["Enums"]["submission_type"]
        }
        Returns: {
          category: string
          distinct_trials: number
          first_seen: string
          hits: number
          last_seen: string
          member_state: string
          resolved_hits: number
          section: string
          section_part: Database["public"]["Enums"]["section_part"]
        }[]
      }
      rule_precedents: {
        Args: {
          f_category: string
          f_member_states?: string[]
          f_section?: string
          f_submission_type?: Database["public"]["Enums"]["submission_type"]
          match_count?: number
        }
        Returns: {
          consideration_id: string
          consideration_text: string
          document_ref: string
          eu_trial_number: string
          issued_at: string
          member_state: string
          outcome: Database["public"]["Enums"]["rfi_outcome"]
          protocol_code: string
          response_status: Database["public"]["Enums"]["response_status"]
          section: string
          sponsor_response_text: string
        }[]
      }
      hybrid_search: {
        Args: {
          f_approved_only?: boolean
          f_category?: string
          f_from?: string
          f_imp_name?: string
          f_member_state?: string
          f_part?: Database["public"]["Enums"]["section_part"]
          f_protocol_code?: string
          f_section?: string
          f_therapeutic_area?: string
          match_count?: number
          query_embed: string
          query_text: string
          rrf_k?: number
        }
        Returns: {
          consideration_id: string
          fts_rank: number
          kind: string
          rrf_score: number
          vector_rank: number
          vector_similarity: number
        }[]
      }
      keyword_search: {
        Args: { match_count?: number; query_text: string }
        Returns: {
          consideration_id: string
          kind: string
          rank: number
        }[]
      }
      rfi_stats_by_category: {
        Args: never
        Returns: {
          accepted: number
          category: string
          distinct_trials: number
          member_states: number
          occurrences: number
          open_items: number
        }[]
      }
      rfi_stats_by_member_state: {
        Args: never
        Returns: {
          distinct_trials: number
          member_state: string
          occurrences: number
        }[]
      }
      rfi_stats_by_month: {
        Args: { f_member_state?: string }
        Returns: {
          member_states: number
          month: string
          occurrences: number
        }[]
      }
      rfi_turnaround_stats: {
        Args: never
        Returns: {
          answered: number
          answered_late: number
          mean_days: number
          median_days: number
          p90_days: number
          unanswered: number
        }[]
      }
      search_considerations: {
        Args: {
          f_category?: string
          f_from?: string
          f_imp_name?: string
          f_member_state?: string
          f_part?: Database["public"]["Enums"]["section_part"]
          f_phase?: Database["public"]["Enums"]["rfi_phase"]
          f_protocol_code?: string
          f_section?: string
          f_status?: Database["public"]["Enums"]["response_status"]
          f_submission_type?: Database["public"]["Enums"]["submission_type"]
          f_therapeutic_area?: string
          f_to?: string
          lim?: number
          off?: number
          q?: string
          sort?: string
        }
        Returns: {
          category: string
          consideration_number: number
          consideration_text: string
          document_name: string
          document_ref: string
          due_at: string
          eu_trial_number: string
          id: string
          imp_name: string
          issued_at: string
          matched_on: string
          member_state: string
          outcome: Database["public"]["Enums"]["rfi_outcome"]
          owner_team: Database["public"]["Enums"]["team_role"]
          phase: Database["public"]["Enums"]["rfi_phase"]
          rank: number
          response_status: Database["public"]["Enums"]["response_status"]
          section: string
          section_part: Database["public"]["Enums"]["section_part"]
          short_title: string
          sponsor_response_text: string
          submission_type: Database["public"]["Enums"]["submission_type"]
          therapeutic_area: string
          total_count: number
        }[]
      }
      search_facets: {
        Args: {
          f_imp_name?: string
          f_member_state?: string
          f_part?: Database["public"]["Enums"]["section_part"]
          f_protocol_code?: string
          f_therapeutic_area?: string
          q?: string
        }
        Returns: {
          count: number
          facet: string
          value: string
        }[]
      }
      vector_search: {
        Args: { match_count?: number; query_embed: string }
        Returns: {
          consideration_id: string
          kind: string
          similarity: number
        }[]
      }
    }
    Enums: {
      response_status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "SUBMITTED"
      rfi_outcome: "ACCEPTED" | "FOLLOW_UP_RFI" | "UNKNOWN"
      rfi_phase: "VALIDATION" | "ASSESSMENT_PART_I" | "ASSESSMENT_PART_II"
      section_part: "PART_I" | "PART_II"
      submission_type: "INITIAL" | "SUBSTANTIAL_MODIFICATION" | "ADDITIONAL_MS"
      team_role:
        | "RA_CLINICAL"
        | "AFFILIATE"
        | "CTA_MANAGEMENT"
        | "EU_SUBMISSION_HUB"
        | "ADMIN"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      response_status: ["DRAFT", "IN_REVIEW", "APPROVED", "SUBMITTED"],
      rfi_outcome: ["ACCEPTED", "FOLLOW_UP_RFI", "UNKNOWN"],
      rfi_phase: ["VALIDATION", "ASSESSMENT_PART_I", "ASSESSMENT_PART_II"],
      section_part: ["PART_I", "PART_II"],
      submission_type: ["INITIAL", "SUBSTANTIAL_MODIFICATION", "ADDITIONAL_MS"],
      team_role: [
        "RA_CLINICAL",
        "AFFILIATE",
        "CTA_MANAGEMENT",
        "EU_SUBMISSION_HUB",
        "ADMIN",
      ],
    },
  },
} as const
