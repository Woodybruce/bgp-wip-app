-- Deal checklist on a letting (Woody, 2026-11-12): a list of things to do by
-- stage, each with a responsible person (BGP, the client or a joint agent).
-- Making someone responsible puts the item on their task list and emails
-- them. Additive and safe to run again.

-- One checklist per letting: the tracker unit and its current deal. A unit
-- that is re-marketed gets a new deal and so a new checklist.
CREATE TABLE IF NOT EXISTS deal_checklists (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id varchar NOT NULL,
  deal_id varchar,
  template_key text,                    -- which standard list it was started from
  responsible_user_id varchar,          -- who is responsible for the deal as a whole
  responsible_brief_person_id varchar,
  responsible_name text,
  responsible_email text,
  responsible_side text,                -- 'bgp' | 'client' | 'joint_agent'
  created_by_user_id varchar,
  created_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_checklists_unit_deal ON deal_checklists (unit_id, COALESCE(deal_id, ''));

CREATE TABLE IF NOT EXISTS deal_checklist_items (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id varchar NOT NULL,
  unit_id varchar NOT NULL,
  stage text NOT NULL,                  -- enquiry | negotiating | under_offer | exchanged
  label text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  assignee_user_id varchar,             -- a login: gets a task and an email
  assignee_brief_person_id varchar,     -- a person on the brief with no login: email only
  assignee_name text,
  assignee_email text,
  assignee_side text,                   -- 'bgp' | 'client' | 'joint_agent'
  assigned_at timestamp,
  assigned_by_name text,
  due_date text,                        -- yyyy-mm-dd
  note text,
  done_at timestamp,
  done_by_user_id varchar,
  done_by_name text,
  task_id varchar,                      -- the user_tasks row made for the assignee
  notified_at timestamp,                -- when the assignee was last emailed
  created_by_user_id varchar,
  created_by_name text,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deal_checklist_items_checklist ON deal_checklist_items (checklist_id, stage, sort_order);
CREATE INDEX IF NOT EXISTS idx_deal_checklist_items_unit ON deal_checklist_items (unit_id);
CREATE INDEX IF NOT EXISTS idx_deal_checklist_items_assignee ON deal_checklist_items (assignee_user_id) WHERE done_at IS NULL;
