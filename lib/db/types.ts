// Generated from the live Supabase project (rfi-vault, eu-central-1).
// Regenerate with `npm run db:types` after every migration. Do not hand-edit.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
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
      draft_application: {
        Row: {
          created_at: string
          id: string
          member_states: string[]
          submission_type: Database["public"]["Enums"]["submission_type"]
          title: string
          trial_id: string | null
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          member_states?: string[]
          submission_type: Database["public"]["Enums"]["submission_type"]
          title: string
          trial_id?: string | null
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          member_states?: string[]
          submission_type?: Database["public"]["Enums"]["submission_type"]
          title?: string
          trial_id?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_application_trial_id_fkey"
            columns: ["trial_id"]
            isOneToOne: false
            referencedRelation: "trial"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_section: {
        Row: {
          artefacts: Json
          content: string
          created_at: string
          draft_id: string
          id: string
          section: string
          section_part: Database["public"]["Enums"]["section_part"]
        }
        Insert: {
          artefacts?: Json
          content: string
          created_at?: string
          draft_id: string
          id?: string
          section: string
          section_part: Database["public"]["Enums"]["section_part"]
        }
        Update: {
          artefacts?: Json
          content?: string
          created_at?: string
          draft_id?: string
          id?: string
          section?: string
          section_part?: Database["public"]["Enums"]["section_part"]
        }
        Relationships: [
          {
            foreignKeyName: "draft_section_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "draft_application"
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
      risk_assessment: {
        Row: {
          band: string
          base_rate: number | null
          created_at: string
          draft_section_id: string
          explanation: string | null
          id: string
          member_state: string | null
          recommended_action: string | null
          rule_findings: Json
          score: number
          similarity_top: Json
        }
        Insert: {
          band: string
          base_rate?: number | null
          created_at?: string
          draft_section_id: string
          explanation?: string | null
          id?: string
          member_state?: string | null
          recommended_action?: string | null
          rule_findings?: Json
          score: number
          similarity_top?: Json
        }
        Update: {
          band?: string
          base_rate?: number | null
          created_at?: string
          draft_section_id?: string
          explanation?: string | null
          id?: string
          member_state?: string | null
          recommended_action?: string | null
          rule_findings?: Json
          score?: number
          similarity_top?: Json
        }
        Relationships: [
          {
            foreignKeyName: "risk_assessment_draft_section_id_fkey"
            columns: ["draft_section_id"]
            isOneToOne: false
            referencedRelation: "draft_section"
            referencedColumns: ["id"]
          },
        ]
      }
      trial: {
        Row: {
          created_at: string
          eu_trial_number: string
          id: string
          member_states: string[]
          phase: string | null
          short_title: string
          sponsor: string
          therapeutic_area: string | null
        }
        Insert: {
          created_at?: string
          eu_trial_number: string
          id?: string
          member_states?: string[]
          phase?: string | null
          short_title: string
          sponsor?: string
          therapeutic_area?: string | null
        }
        Update: {
          created_at?: string
          eu_trial_number?: string
          id?: string
          member_states?: string[]
          phase?: string | null
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
      current_team: {
        Args: never
        Returns: Database["public"]["Enums"]["team_role"]
      }
      hybrid_search: {
        Args: {
          f_approved_only?: boolean
          f_category?: string
          f_from?: string
          f_member_state?: string
          f_part?: Database["public"]["Enums"]["section_part"]
          f_section?: string
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
      vector_search: {
        Args: { match_count?: number; query_embed: string }
        Returns: {
          consideration_id: string
          kind: string
          similarity: number
        }[]
      }
      search_considerations: {
        Args: {
          q?: string
          f_part?: Database["public"]["Enums"]["section_part"]
          f_section?: string
          f_member_state?: string
          f_category?: string
          f_phase?: Database["public"]["Enums"]["rfi_phase"]
          f_submission_type?: Database["public"]["Enums"]["submission_type"]
          f_status?: Database["public"]["Enums"]["response_status"]
          f_from?: string
          f_to?: string
          sort?: string
          lim?: number
          off?: number
        }
        Returns: {
          id: string
          consideration_number: number
          section_part: Database["public"]["Enums"]["section_part"]
          section: string
          document_name: string | null
          member_state: string | null
          category: string
          consideration_text: string
          sponsor_response_text: string | null
          response_status: Database["public"]["Enums"]["response_status"]
          outcome: Database["public"]["Enums"]["rfi_outcome"]
          owner_team: Database["public"]["Enums"]["team_role"] | null
          document_ref: string
          submission_type: Database["public"]["Enums"]["submission_type"]
          phase: Database["public"]["Enums"]["rfi_phase"]
          issued_at: string
          due_at: string | null
          eu_trial_number: string
          short_title: string
          rank: number
          matched_on: string
          total_count: number
        }[]
      }
      search_facets: {
        Args: {
          q?: string
          f_part?: Database["public"]["Enums"]["section_part"]
          f_member_state?: string
        }
        Returns: {
          facet: string
          value: string
          count: number
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
