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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_bootstrap_state: {
        Row: {
          bootstrapped_at: string
          bootstrapped_by: string
          singleton: boolean
        }
        Insert: {
          bootstrapped_at?: string
          bootstrapped_by: string
          singleton?: boolean
        }
        Update: {
          bootstrapped_at?: string
          bootstrapped_by?: string
          singleton?: boolean
        }
        Relationships: []
      }
      admin_memberships: {
        Row: {
          created_at: string
          is_active: boolean
          permissions: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          is_active?: boolean
          permissions?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          is_active?: boolean
          permissions?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      app_files: {
        Row: {
          created_at: string
          created_by: string | null
          entity: string
          field_name: string
          file_name: string
          id: string
          mime_type: string
          record_id: string
          size: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity: string
          field_name: string
          file_name: string
          id?: string
          mime_type?: string
          record_id: string
          size?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity?: string
          field_name?: string
          file_name?: string
          id?: string
          mime_type?: string
          record_id?: string
          size?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "app_files_record_id_fkey"
            columns: ["record_id"]
            isOneToOne: false
            referencedRelation: "app_records"
            referencedColumns: ["id"]
          },
        ]
      }
      app_members: {
        Row: {
          created_at: string
          email: string
          role: string
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          role?: string
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          role?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      app_records: {
        Row: {
          created_at: string
          created_by: string | null
          data: Json
          entity: string
          id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          data?: Json
          entity: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          data?: Json
          entity?: string
          id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          admin_id: string | null
          after_json: Json | null
          before_json: Json | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_memberships"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cron_execution_logs: {
        Row: {
          created_at: string
          error_code: string | null
          failed_count: number
          finished_at: string | null
          id: string
          job_name: string
          request_id: string
          sent_count: number
          started_at: string
          status: string
          target_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          job_name: string
          request_id: string
          sent_count?: number
          started_at?: string
          status: string
          target_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          failed_count?: number
          finished_at?: string | null
          id?: string
          job_name?: string
          request_id?: string
          sent_count?: number
          started_at?: string
          status?: string
          target_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      homes: {
        Row: {
          city: string | null
          created_at: string
          district: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          city?: string | null
          created_at?: string
          district?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          city?: string | null
          created_at?: string
          district?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      integration_outbox: {
        Row: {
          aggregate_id: string
          aggregate_type: string
          attempt_count: number
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          destination: string
          event_id: string
          event_type: string
          id: string
          is_test: boolean
          last_error_sanitized: string | null
          last_http_status: number | null
          lease_owner: string | null
          lease_until: string | null
          next_attempt_at: string | null
          payload: Json
          status: string
          updated_at: string
        }
        Insert: {
          aggregate_id: string
          aggregate_type: string
          attempt_count?: number
          created_at?: string
          dedupe_key: string
          delivered_at?: string | null
          destination: string
          event_id?: string
          event_type: string
          id?: string
          is_test?: boolean
          last_error_sanitized?: string | null
          last_http_status?: number | null
          lease_owner?: string | null
          lease_until?: string | null
          next_attempt_at?: string | null
          payload: Json
          status?: string
          updated_at?: string
        }
        Update: {
          aggregate_id?: string
          aggregate_type?: string
          attempt_count?: number
          created_at?: string
          dedupe_key?: string
          delivered_at?: string | null
          destination?: string
          event_id?: string
          event_type?: string
          id?: string
          is_test?: boolean
          last_error_sanitized?: string | null
          last_http_status?: number | null
          lease_owner?: string | null
          lease_until?: string | null
          next_attempt_at?: string | null
          payload?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      matches: {
        Row: {
          contract_end_date: string | null
          created_at: string
          guest_id: string
          home_id: string
          host_id: string
          id: string
          move_in_date: string
          move_out_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          contract_end_date?: string | null
          created_at?: string
          guest_id: string
          home_id: string
          host_id: string
          id?: string
          move_in_date: string
          move_out_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          contract_end_date?: string | null
          created_at?: string
          guest_id?: string
          home_id?: string
          host_id?: string
          id?: string
          move_in_date?: string
          move_out_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "matches_guest_id_fkey"
            columns: ["guest_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_home_id_fkey"
            columns: ["home_id"]
            isOneToOne: false
            referencedRelation: "homes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "matches_host_id_fkey"
            columns: ["host_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      message_attempts: {
        Row: {
          attempt_number: number
          created_at: string
          error_code: string | null
          error_message_sanitized: string | null
          id: string
          is_test: boolean
          message_log_id: string
          provider_message_id: string | null
          status: string
        }
        Insert: {
          attempt_number: number
          created_at?: string
          error_code?: string | null
          error_message_sanitized?: string | null
          id?: string
          is_test?: boolean
          message_log_id: string
          provider_message_id?: string | null
          status: string
        }
        Update: {
          attempt_number?: number
          created_at?: string
          error_code?: string | null
          error_message_sanitized?: string | null
          id?: string
          is_test?: boolean
          message_log_id?: string
          provider_message_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_attempts_message_log_id_fkey"
            columns: ["message_log_id"]
            isOneToOne: false
            referencedRelation: "message_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      message_logs: {
        Row: {
          attempt_count: number
          created_at: string
          error_code: string | null
          error_message_sanitized: string | null
          id: string
          idempotency_key: string
          invitation_id: string | null
          is_test: boolean
          lease_owner: string | null
          lease_until: string | null
          message_type: string
          next_attempt_at: string | null
          provider: string
          provider_message_id: string | null
          recipient_masked: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          error_message_sanitized?: string | null
          id?: string
          idempotency_key: string
          invitation_id?: string | null
          is_test?: boolean
          lease_owner?: string | null
          lease_until?: string | null
          message_type: string
          next_attempt_at?: string | null
          provider: string
          provider_message_id?: string | null
          recipient_masked: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          error_code?: string | null
          error_message_sanitized?: string | null
          id?: string
          idempotency_key?: string
          invitation_id?: string | null
          is_test?: boolean
          lease_owner?: string | null
          lease_until?: string | null
          message_type?: string
          next_attempt_at?: string | null
          provider?: string
          provider_message_id?: string | null
          recipient_masked?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_logs_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          auth_user_id: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          phone: string
          profile_type: string
          updated_at: string
        }
        Insert: {
          auth_user_id?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          phone: string
          profile_type: string
          updated_at?: string
        }
        Update: {
          auth_user_id?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          phone?: string
          profile_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limit_buckets: {
        Row: {
          bucket_key: string
          expires_at: string
          request_count: number
          route: string
          window_start: string
        }
        Insert: {
          bucket_key: string
          expires_at: string
          request_count?: number
          route: string
          window_start: string
        }
        Update: {
          bucket_key?: string
          expires_at?: string
          request_count?: number
          route?: string
          window_start?: string
        }
        Relationships: []
      }
      support_case_events: {
        Row: {
          action: string
          admin_id: string | null
          after_json: Json | null
          before_json: Json | null
          created_at: string
          id: string
          is_test: boolean
          note: string | null
          support_case_id: string
        }
        Insert: {
          action: string
          admin_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          id?: string
          is_test?: boolean
          note?: string | null
          support_case_id: string
        }
        Update: {
          action?: string
          admin_id?: string | null
          after_json?: Json | null
          before_json?: Json | null
          created_at?: string
          id?: string
          is_test?: boolean
          note?: string | null
          support_case_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_case_events_admin_id_fkey"
            columns: ["admin_id"]
            isOneToOne: false
            referencedRelation: "admin_memberships"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_case_events_support_case_id_fkey"
            columns: ["support_case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
        ]
      }
      support_cases: {
        Row: {
          acknowledgement_at: string | null
          assigned_admin_id: string | null
          created_at: string
          first_contact_at: string | null
          id: string
          internal_note: string | null
          is_test: boolean
          match_id: string
          participant_id: string
          priority: string
          resolution_code: string | null
          resolved_at: string | null
          response_id: string
          status: string
          updated_at: string
        }
        Insert: {
          acknowledgement_at?: string | null
          assigned_admin_id?: string | null
          created_at?: string
          first_contact_at?: string | null
          id?: string
          internal_note?: string | null
          is_test?: boolean
          match_id: string
          participant_id: string
          priority: string
          resolution_code?: string | null
          resolved_at?: string | null
          response_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          acknowledgement_at?: string | null
          assigned_admin_id?: string | null
          created_at?: string
          first_contact_at?: string | null
          id?: string
          internal_note?: string | null
          is_test?: boolean
          match_id?: string
          participant_id?: string
          priority?: string
          resolution_code?: string | null
          resolved_at?: string | null
          response_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_cases_assigned_admin_id_fkey"
            columns: ["assigned_admin_id"]
            isOneToOne: false
            referencedRelation: "admin_memberships"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "support_cases_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_cases_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: true
            referencedRelation: "weekly_checkin_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_checkin_drafts: {
        Row: {
          answers_json: Json
          created_at: string
          invitation_id: string
          questionnaire_version: string
          revision: number
          updated_at: string
        }
        Insert: {
          answers_json?: Json
          created_at?: string
          invitation_id: string
          questionnaire_version: string
          revision?: number
          updated_at?: string
        }
        Update: {
          answers_json?: Json
          created_at?: string
          invitation_id?: string
          questionnaire_version?: string
          revision?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_checkin_drafts_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "weekly_checkin_invitations"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_checkin_invitations: {
        Row: {
          completed_at: string | null
          created_at: string
          expires_at: string
          id: string
          is_test: boolean
          last_error_code: string | null
          lease_owner: string | null
          lease_until: string | null
          match_id: string
          next_attempt_at: string | null
          opened_at: string | null
          participant_id: string
          reminder_sent_at: string | null
          role: string
          run_id: string
          send_attempt_count: number
          sent_at: string | null
          status: string
          token_hash: string
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          is_test?: boolean
          last_error_code?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          match_id: string
          next_attempt_at?: string | null
          opened_at?: string | null
          participant_id: string
          reminder_sent_at?: string | null
          role: string
          run_id: string
          send_attempt_count?: number
          sent_at?: string | null
          status?: string
          token_hash: string
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          is_test?: boolean
          last_error_code?: string | null
          lease_owner?: string | null
          lease_until?: string | null
          match_id?: string
          next_attempt_at?: string | null
          opened_at?: string | null
          participant_id?: string
          reminder_sent_at?: string | null
          role?: string
          run_id?: string
          send_attempt_count?: number
          sent_at?: string | null
          status?: string
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_checkin_invitations_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_invitations_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_invitations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_admin_run_stats"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "weekly_checkin_invitations_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_checkin_issues: {
        Row: {
          additional_note: string | null
          category: string
          clarification_preference: string | null
          created_at: string
          desired_action: string
          discussion_status: string
          frequency: string
          id: string
          is_test: boolean
          order_index: number
          response_id: string
          severity: number
          subcategory: string
        }
        Insert: {
          additional_note?: string | null
          category: string
          clarification_preference?: string | null
          created_at?: string
          desired_action: string
          discussion_status: string
          frequency: string
          id?: string
          is_test?: boolean
          order_index: number
          response_id: string
          severity: number
          subcategory: string
        }
        Update: {
          additional_note?: string | null
          category?: string
          clarification_preference?: string | null
          created_at?: string
          desired_action?: string
          discussion_status?: string
          frequency?: string
          id?: string
          is_test?: boolean
          order_index?: number
          response_id?: string
          severity?: number
          subcategory?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_checkin_issues_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_checkin_responses: {
        Row: {
          answers_json: Json
          contact_method: string | null
          contact_window: string | null
          created_at: string
          desired_support: string[]
          disclosure_preference: string | null
          id: string
          immediate_danger: string | null
          invitation_id: string
          is_test: boolean
          issue_status: string | null
          match_id: string
          overall_status: string
          paired_mismatch: boolean
          participant_id: string
          positive_points: string[]
          question_snapshot: Json
          questionnaire_version: string
          risk_level: string
          risk_reasons: Json
          role: string
          safe_location: string | null
          safe_to_contact: string | null
          submitted_at: string
        }
        Insert: {
          answers_json: Json
          contact_method?: string | null
          contact_window?: string | null
          created_at?: string
          desired_support?: string[]
          disclosure_preference?: string | null
          id?: string
          immediate_danger?: string | null
          invitation_id: string
          is_test?: boolean
          issue_status?: string | null
          match_id: string
          overall_status: string
          paired_mismatch?: boolean
          participant_id: string
          positive_points?: string[]
          question_snapshot?: Json
          questionnaire_version: string
          risk_level: string
          risk_reasons?: Json
          role: string
          safe_location?: string | null
          safe_to_contact?: string | null
          submitted_at?: string
        }
        Update: {
          answers_json?: Json
          contact_method?: string | null
          contact_window?: string | null
          created_at?: string
          desired_support?: string[]
          disclosure_preference?: string | null
          id?: string
          immediate_danger?: string | null
          invitation_id?: string
          is_test?: boolean
          issue_status?: string | null
          match_id?: string
          overall_status?: string
          paired_mismatch?: boolean
          participant_id?: string
          positive_points?: string[]
          question_snapshot?: Json
          questionnaire_version?: string
          risk_level?: string
          risk_reasons?: Json
          role?: string
          safe_location?: string | null
          safe_to_contact?: string | null
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_checkin_responses_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: true
            referencedRelation: "weekly_checkin_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_responses_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_responses_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_checkin_runs: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          is_test: boolean
          reminder_at: string | null
          send_at: string
          status: string
          updated_at: string
          week_end: string
          week_start: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          is_test?: boolean
          reminder_at?: string | null
          send_at: string
          status?: string
          updated_at?: string
          week_end: string
          week_start: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          is_test?: boolean
          reminder_at?: string | null
          send_at?: string
          status?: string
          updated_at?: string
          week_end?: string
          week_start?: string
        }
        Relationships: []
      }
      weekly_checkin_signals: {
        Row: {
          created_at: string
          id: string
          invitation_id: string | null
          is_test: boolean
          match_id: string
          participant_id: string
          reasons: Json
          risk_level: string
          run_id: string
          signal_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          invitation_id?: string | null
          is_test?: boolean
          match_id: string
          participant_id: string
          reasons?: Json
          risk_level?: string
          run_id: string
          signal_type: string
        }
        Update: {
          created_at?: string
          id?: string
          invitation_id?: string | null
          is_test?: boolean
          match_id?: string
          participant_id?: string
          reasons?: Json
          risk_level?: string
          run_id?: string
          signal_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_checkin_signals_invitation_id_fkey"
            columns: ["invitation_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_invitations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_signals_match_id_fkey"
            columns: ["match_id"]
            isOneToOne: false
            referencedRelation: "matches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_signals_participant_id_fkey"
            columns: ["participant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_checkin_signals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_admin_run_stats"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "weekly_checkin_signals_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "weekly_checkin_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      weekly_checkin_admin_run_stats: {
        Row: {
          completed_count: number | null
          green_count: number | null
          guest_completed_count: number | null
          guest_target_count: number | null
          host_completed_count: number | null
          host_target_count: number | null
          is_test_run: boolean | null
          orange_count: number | null
          red_count: number | null
          run_id: string | null
          status: string | null
          target_count: number | null
          test_invitation_count: number | null
          week_end: string | null
          week_start: string | null
          yellow_count: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      admin_has_permission: {
        Args: { p_required_permission: string; p_user_id: string }
        Returns: boolean
      }
      admin_update_support_case: {
        Args: {
          p_action: string
          p_admin_id: string
          p_assigned_admin_id?: string
          p_case_id: string
          p_internal_note?: string
          p_resolution_code?: string
        }
        Returns: {
          acknowledgement_at: string | null
          assigned_admin_id: string | null
          created_at: string
          first_contact_at: string | null
          id: string
          internal_note: string | null
          is_test: boolean
          match_id: string
          participant_id: string
          priority: string
          resolution_code: string | null
          resolved_at: string | null
          response_id: string
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "support_cases"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      bootstrap_first_admin: {
        Args: { p_expected_email: string; p_user_id: string }
        Returns: {
          created_at: string
          is_active: boolean
          permissions: string[]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "admin_memberships"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_edit_app: { Args: { check_user_id: string }; Returns: boolean }
      claim_message_deliveries: {
        Args: {
          p_lease_owner: string
          p_lease_seconds?: number
          p_limit?: number
          p_provider: string
        }
        Returns: {
          expires_at: string
          idempotency_key: string
          invitation_id: string
          message_log_id: string
          message_type: string
          participant_id: string
          participant_role: string
          phone: string
          recipient_name: string
          token_hash: string
          week_end: string
          week_start: string
        }[]
      }
      claim_outbox_events: {
        Args: {
          p_destination: string
          p_lease_owner: string
          p_lease_seconds?: number
          p_limit?: number
        }
        Returns: {
          aggregate_id: string
          aggregate_type: string
          attempt_count: number
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          destination: string
          event_id: string
          event_type: string
          id: string
          is_test: boolean
          last_error_sanitized: string | null
          last_http_status: number | null
          lease_owner: string | null
          lease_until: string | null
          next_attempt_at: string | null
          payload: Json
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "integration_outbox"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_message_delivery: {
        Args: {
          p_error_code?: string
          p_error_message_sanitized?: string
          p_lease_owner: string
          p_message_log_id: string
          p_next_attempt_at?: string
          p_provider_message_id?: string
          p_retryable?: boolean
          p_success: boolean
        }
        Returns: {
          attempt_count: number
          created_at: string
          error_code: string | null
          error_message_sanitized: string | null
          id: string
          idempotency_key: string
          invitation_id: string | null
          is_test: boolean
          lease_owner: string | null
          lease_until: string | null
          message_type: string
          next_attempt_at: string | null
          provider: string
          provider_message_id: string | null
          recipient_masked: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "message_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      complete_outbox_event: {
        Args: {
          p_error_sanitized?: string
          p_http_status?: number
          p_lease_owner: string
          p_next_attempt_at?: string
          p_outbox_id: string
          p_retryable?: boolean
          p_success: boolean
        }
        Returns: {
          aggregate_id: string
          aggregate_type: string
          attempt_count: number
          created_at: string
          dedupe_key: string
          delivered_at: string | null
          destination: string
          event_id: string
          event_type: string
          id: string
          is_test: boolean
          last_error_sanitized: string | null
          last_http_status: number | null
          lease_owner: string | null
          lease_until: string | null
          next_attempt_at: string | null
          payload: Json
          status: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "integration_outbox"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      consume_checkin_rate_limit: {
        Args: {
          p_ip_hash: string
          p_limit?: number
          p_token_hash: string
          p_window_seconds?: number
        }
        Returns: boolean
      }
      consume_rate_limit: {
        Args: {
          p_bucket_key: string
          p_limit: number
          p_route: string
          p_window_seconds?: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      create_weekly_checkin_batch:
        | {
            Args: {
              p_candidates: Json
              p_expires_at: string
              p_provider?: string
              p_reminder_at: string
              p_send_at: string
              p_week_end: string
              p_week_start: string
            }
            Returns: {
              invitation_id: string
              match_id: string
              participant_id: string
              role: string
              run_id: string
              token_hash: string
            }[]
          }
        | {
            Args: {
              p_candidates: Json
              p_expires_at: string
              p_is_test: boolean
              p_provider: string
              p_reminder_at: string
              p_send_at: string
              p_week_end: string
              p_week_start: string
            }
            Returns: {
              invitation_id: string
              match_id: string
              participant_id: string
              role: string
              run_id: string
              token_hash: string
            }[]
          }
      enqueue_weekly_checkin_reminders: {
        Args: { p_provider?: string; p_run_id: string }
        Returns: number
      }
      is_admin: { Args: { required_permission?: string }; Returns: boolean }
      is_app_member: { Args: { check_user_id: string }; Returns: boolean }
      purge_expired_rate_limits: { Args: never; Returns: number }
      record_cron_execution: {
        Args: {
          p_error_code?: string
          p_failed_count?: number
          p_job_name: string
          p_request_id: string
          p_sent_count?: number
          p_status: string
          p_target_count?: number
        }
        Returns: {
          created_at: string
          error_code: string | null
          failed_count: number
          finished_at: string | null
          id: string
          job_name: string
          request_id: string
          sent_count: number
          started_at: string
          status: string
          target_count: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "cron_execution_logs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_nonresponse_signals: {
        Args: { p_run_id: string }
        Returns: number
      }
      save_weekly_checkin_draft: {
        Args: {
          p_answers: Json
          p_invitation_id: string
          p_questionnaire_version: string
          p_token_hash: string
        }
        Returns: {
          answers_json: Json
          created_at: string
          invitation_id: string
          questionnaire_version: string
          revision: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "weekly_checkin_drafts"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      submit_weekly_checkin:
        | {
            Args: {
              p_invitation_id: string
              p_paired_mismatch?: boolean
              p_risk_level: string
              p_risk_reasons: Json
              p_submission: Json
              p_token_hash: string
            }
            Returns: {
              already_completed: boolean
              response_id: string
              support_case_id: string
            }[]
          }
        | {
            Args: {
              p_paired_mismatch: boolean
              p_risk_level: string
              p_risk_reasons: Json
              p_submission: Json
              p_token_hash: string
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
    Enums: {},
  },
} as const
