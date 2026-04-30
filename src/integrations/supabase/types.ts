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
      agents: {
        Row: {
          agent_id: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          updated_at: string
          user_id: string
          webhook_secret: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
          user_id: string
          webhook_secret?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
          user_id?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      call_logs: {
        Row: {
          created_at: string
          direction: string
          duration_seconds: number | null
          id: string
          lead_id: string
          next_action_at: string | null
          notes: string | null
          outcome: string
          source: string
          updated_at: string
          user_id: string
          vapi_call_id: string | null
        }
        Insert: {
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          id?: string
          lead_id: string
          next_action_at?: string | null
          notes?: string | null
          outcome?: string
          source?: string
          updated_at?: string
          user_id: string
          vapi_call_id?: string | null
        }
        Update: {
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          id?: string
          lead_id?: string
          next_action_at?: string | null
          notes?: string | null
          outcome?: string
          source?: string
          updated_at?: string
          user_id?: string
          vapi_call_id?: string | null
        }
        Relationships: []
      }
      email_resend_attempts: {
        Row: {
          created_at: string
          email: string
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      lead_reminders: {
        Row: {
          auto_created: boolean
          completed_at: string | null
          created_at: string
          due_at: string
          id: string
          kind: string
          lead_id: string
          note: string | null
          status: string
          triggered_by_status: string | null
          user_id: string
        }
        Insert: {
          auto_created?: boolean
          completed_at?: string | null
          created_at?: string
          due_at: string
          id?: string
          kind?: string
          lead_id: string
          note?: string | null
          status?: string
          triggered_by_status?: string | null
          user_id: string
        }
        Update: {
          auto_created?: boolean
          completed_at?: string | null
          created_at?: string
          due_at?: string
          id?: string
          kind?: string
          lead_id?: string
          note?: string | null
          status?: string
          triggered_by_status?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_reminders_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          budget: string | null
          created_at: string
          full_name: string
          id: string
          location: string | null
          notes: string | null
          phone: string | null
          property_type: string | null
          source: string
          status: string
          urgency: string | null
          user_id: string
        }
        Insert: {
          budget?: string | null
          created_at?: string
          full_name: string
          id?: string
          location?: string | null
          notes?: string | null
          phone?: string | null
          property_type?: string | null
          source?: string
          status?: string
          urgency?: string | null
          user_id: string
        }
        Update: {
          budget?: string | null
          created_at?: string
          full_name?: string
          id?: string
          location?: string | null
          notes?: string | null
          phone?: string | null
          property_type?: string | null
          source?: string
          status?: string
          urgency?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          agent_id: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          is_subscribed: boolean
          stripe_customer_id: string | null
          webhook_secret: string
        }
        Insert: {
          agent_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          is_subscribed?: boolean
          stripe_customer_id?: string | null
          webhook_secret?: string
        }
        Update: {
          agent_id?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          is_subscribed?: boolean
          stripe_customer_id?: string | null
          webhook_secret?: string
        }
        Relationships: []
      }
      reminder_rules: {
        Row: {
          closed_hours: number | null
          contacted_hours: number | null
          created_at: string
          enabled: boolean
          lost_hours: number | null
          new_hours: number | null
          scheduled_hours: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          closed_hours?: number | null
          contacted_hours?: number | null
          created_at?: string
          enabled?: boolean
          lost_hours?: number | null
          new_hours?: number | null
          scheduled_hours?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          closed_hours?: number | null
          contacted_hours?: number | null
          created_at?: string
          enabled?: boolean
          lost_hours?: number | null
          new_hours?: number | null
          scheduled_hours?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      webhook_ip_attempts: {
        Row: {
          agent_id: string | null
          created_at: string
          id: string
          ip: string
          outcome: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          id?: string
          ip: string
          outcome: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          id?: string
          ip?: string
          outcome?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          agent_id: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          http_status: number
          id: string
          ip: string | null
          lead_id: string | null
          payload_summary: Json | null
          request_id: string
          source: string
          stage: string
          status: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          agent_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status: number
          id?: string
          ip?: string | null
          lead_id?: string | null
          payload_summary?: Json | null
          request_id: string
          source?: string
          stage: string
          status: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          agent_id?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          http_status?: number
          id?: string
          ip?: string | null
          lead_id?: string | null
          payload_summary?: Json | null
          request_id?: string
          source?: string
          stage?: string
          status?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      prune_webhook_ip_attempts: { Args: never; Returns: undefined }
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
