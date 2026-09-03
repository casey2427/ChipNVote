-- Remove Super Vote from the active ChipNVote product.
-- Keep legacy columns in plan_scores for compatibility, but they now always return zero.

DELETE FROM public.super_votes;

REVOKE ALL ON TABLE public.super_votes FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.toggle_super_vote(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.plan_scores AS
SELECT
  p.id,
  p.group_id,
  p.event_id,
  p.title,
  p.description,
  p.location,
  p.planned_for,
  p.created_at,
  CASE
    WHEN e.voting_deadline IS NOT NULL AND now() < e.voting_deadline THEN 0
    ELSE COALESCE((
      SELECT sum(v.chips)
      FROM public.votes v
      WHERE v.plan_id = p.id
    ), 0)::integer
  END AS regular_points,
  0::integer AS super_votes,
  0::integer AS super_value,
  CASE
    WHEN e.voting_deadline IS NOT NULL AND now() < e.voting_deadline THEN 0
    ELSE COALESCE((
      SELECT count(DISTINCT v.user_id)
      FROM public.votes v
      WHERE v.plan_id = p.id
    ), 0)::integer
  END AS supporters,
  CASE
    WHEN e.voting_deadline IS NOT NULL AND now() < e.voting_deadline THEN 0
    ELSE COALESCE((
      SELECT sum(v.chips)
      FROM public.votes v
      WHERE v.plan_id = p.id
    ), 0)::integer
  END AS total_score
FROM public.plans p
JOIN public.events e ON e.id = p.event_id
WHERE p.status = 'open';
