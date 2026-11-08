import json
from pathlib import Path
from main import validate_and_score_dag, load_ground_truth_dag

def test():
    gt = load_ground_truth_dag()
    assert len(gt["steps"]) == 10, f"Expected 10 steps, got {len(gt['steps'])}"
    assert len(gt["edges"]) == 11, f"Expected 11 edges, got {len(gt['edges'])}"
    
    # Test scoring ground truth against itself
    score_perfect, val_perfect = validate_and_score_dag(gt)
    print("Perfect DAG score:", json.dumps(score_perfect, indent=2))
    assert score_perfect["step_precision"] == 1.0
    assert score_perfect["step_recall"] == 1.0
    assert score_perfect["edge_precision"] == 1.0
    assert score_perfect["edge_recall"] == 1.0
    assert score_perfect["evidence_accuracy"] == 1.0
    assert score_perfect["safety_accuracy"] == 1.0
    assert score_perfect["unsupported_edges"] == 0
    print("All quotes verified:", all(v["valid"] for v in val_perfect))
    assert all(v["valid"] for v in val_perfect)
    
    # Test MOCK_MODE extraction (1 missing edge, 1 wrong evidence type)
    mock_dag = json.loads(json.dumps(gt))
    mock_dag["edges"] = [e for e in mock_dag["edges"] if not (e["from"] == 6 and e["to"] == 8)]
    for s in mock_dag["steps"]:
        if s["id"] == 8:
            s["evidence"] = "visual"
            
    mock_score, mock_val = validate_and_score_dag(mock_dag)
    print("Mock DAG score:", json.dumps(mock_score, indent=2))
    assert mock_score["edge_recall"] < 1.0, "Expected missing edge to reduce edge recall"
    assert mock_score["evidence_accuracy"] < 1.0, "Expected wrong evidence to reduce evidence accuracy"
    print("Mock extraction validation and scoring test passed!")

if __name__ == "__main__":
    test()
