"""Tests for scripts/scaffold_issue_content.

The scaffolder inverts a rendered brief into the content-override shape. Its
keys must mirror the renderer's topicKey (rendered titles are canonical), and
it must carry finding/evidence/quote/next-step, unresolved questions, comparison
framing, and the selection order so the draft re-renders to the same output.
"""

from scripts.scaffold_issue_content import build_content, topic_key

RENDERED = {
    "note": "closing note",
    "surfaced_findings": [
        {
            "title": "EDC Blueprint Page",
            "finding_statement": "Users understand the category but the page needs clarity.",
            "proof_point": "Fewer than 5 named the Success Blueprint unprompted.",
            "respondent_quote": "Why would you assume I'd start an assessment straight away?",
            "next_step": "Clarify what the assessment produces.",
            "confidence": "medium",
        },
        {
            "title": "Accelerate Live Stream",
            "finding_statement": "Make the event feel live immediately.",
            "proof_point": "Action intent is fragmented; no single CTA dominates.",
            "next_step": "Make Watch Live dominant.",
            "confidence": "high",
        },
    ],
    "unresolved_questions": [
        {
            "title": "Platform Diagram Update",
            "scope": "Perception shift",
            "question": "Does it read as AI-ready?",
        }
    ],
    "comparison_tests": [
        {
            "title": "Events Page",
            "finding_statement": "Narrowed comparison.",
            "decision_criteria": "first-glance comprehension",
            "next_step": "Use V4b.",
        }
    ],
}


def test_topic_key_matches_renderer_convention():
    assert topic_key("EDC Blueprint Page") == "edc_blueprint_page"
    assert topic_key("Contextual Intelligence PDP") == "contextual_intelligence_pdp"
    assert topic_key('Reader Filter: "This Book"') == "this_book_filter"


def test_build_content_shape_and_fields():
    content = build_content(RENDERED, base={})
    topics = content["topics"]

    edc = topics["edc_blueprint_page"]
    assert edc["finding_statement"].startswith("Users understand")
    assert edc["proof_point"].startswith("Fewer than 5")
    assert edc["respondent_quote"].startswith("Why would you assume")
    assert list(edc.keys()).index("respondent_quote") < list(edc.keys()).index("next_step")

    # No quote → field omitted entirely.
    assert "respondent_quote" not in topics["accelerate_live_stream"]

    # Unresolved + comparison routed to the right topics.
    assert topics["platform_diagram_update"]["unresolved"]["scope"] == "Perception shift"
    assert topics["events_page"]["comparison"]["next_step"] == "Use V4b."

    # Selection order mirrors the rendered finding/unresolved order.
    assert content["selection"]["findings_preferred_order"] == [
        "EDC Blueprint Page",
        "Accelerate Live Stream",
    ]
    assert content["selection"]["unresolved_preferred_order"] == ["Platform Diagram Update"]
    assert content["note"] == "closing note"
    assert "statement_template" in content["comparison_defaults"]


def test_base_note_and_defaults_inherited_when_absent():
    rendered = {"surfaced_findings": [], "unresolved_questions": [], "comparison_tests": []}
    content = build_content(rendered, base={"note": "base note", "comparison_defaults": {"x": 1}})
    assert content["note"] == "base note"
    assert content["comparison_defaults"] == {"x": 1}
