#!/usr/bin/env python3
import json
import os
import sys
from typing import Any, Dict, List


def normalize_text(value: Any) -> str:
    return str(value or "").strip()


def normalize_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [normalize_text(v) for v in value if normalize_text(v)]
    if isinstance(value, str):
        return [normalize_text(v) for v in value.split("\n") if normalize_text(v)]
    return []


def normalize_language(value: Any) -> str:
    text = normalize_text(value).lower()
    if not text:
        return "zh-CN"
    if text.startswith("zh"):
        return "zh-CN"
    if text.startswith("en"):
        return "en-US"
    return text


def build_api_base_candidates(api_base: str) -> List[str]:
    base = normalize_text(api_base).rstrip("/")
    if not base:
        return [""]
    candidates = [base]
    if not base.endswith("/v1"):
        candidates.append(f"{base}/v1")
    return candidates


def fallback_optimize(payload: Dict[str, Any], reason: str) -> Dict[str, Any]:
    prompt = normalize_text(payload.get("prompt"))
    task_type = normalize_text(payload.get("taskType")) or "general"
    language = normalize_language(payload.get("language"))
    context_messages = normalize_list(payload.get("contextMessages"))[-6:]
    constraints = normalize_list(payload.get("constraints"))

    context_block = (
        "\n".join([f"{i + 1}. {item}" for i, item in enumerate(context_messages)])
        or ("1. Current conversation default context (no extra context provided)." if language.startswith("en") else "1. 当前会话默认上下文（无额外补充）")
    )
    constraints_block = (
        "\n".join([f"{i + 1}. {item}" for i, item in enumerate(constraints)])
        if constraints
        else ("1. Keep output concise and actionable.\n2. Do not omit key steps." if language.startswith("en") else "1. 输出保持简洁且可执行\n2. 不要省略关键步骤")
    )

    if language.startswith("en"):
        role = "senior software engineering assistant" if task_type == "coding" else "high-quality execution assistant"
        optimized_prompt = f"""You are a {role}. Complete the following task.

## Task Goal
{prompt or "Please complete the task based on the requirement."}

## Known Context
{context_block}

## Constraints
{constraints_block}

## Output Format
Use the following structure:
1. Summary (3-5 bullets)
2. Detailed steps (numbered)
3. Self-check list (at least 3 verifiable items)
"""
    else:
        role = "资深工程开发助手" if task_type == "coding" else "高质量任务执行助手"
        optimized_prompt = f"""你是一名{role}。请完成以下任务。

## 任务目标
{prompt or "请根据给定需求完成任务。"}

## 已知上下文
{context_block}

## 约束条件
{constraints_block}

## 输出格式
请按以下结构输出：
1. 结论摘要（3-5条）
2. 详细步骤（编号）
3. 自检清单（至少3条，可验证）
"""

    return {
        "mode": "fallback",
        "optimizedPrompt": optimized_prompt,
        "changes": [
            "补齐了任务目标、上下文、约束、输出格式四段结构。",
            "引入显式自检要求，提升结果可验证性。",
            "保留了原始任务语义，减少改写偏移。",
        ],
        "rationale": [
            "结构化 Prompt 可降低模型理解歧义。",
            "显式约束和验收规则通常可提升稳定性。",
            reason,
        ],
        "meta": {
            "dspyAvailable": False,
            "language": language,
            "fallbackReason": reason,
        },
    }


def try_dspy_optimize(payload: Dict[str, Any]) -> Dict[str, Any]:
    try:
        import dspy  # type: ignore
    except Exception:
        return fallback_optimize(payload, "本机未安装 dspy，已自动降级到规则改写。")

    model_name = (
        normalize_text(payload.get("model"))
        or normalize_text(os.environ.get("DSPY_MODEL"))
        or normalize_text(os.environ.get("MINIMAX_MODEL"))
        or "minimax/MiniMax-M2.1"
    )
    provider_hint = normalize_text(os.environ.get("DSPY_PROVIDER")) or "openai"
    payload_provider = normalize_text(payload.get("provider"))
    if payload_provider:
        provider_hint = payload_provider
    # LiteLLM requires provider prefix in model name.
    # For OpenAI-compatible gateways (like your Minimax endpoint), default to openai/<model>.
    if "/" not in model_name:
        model_name = f"{provider_hint}/{model_name}"

    api_key = (
        normalize_text(payload.get("apiKey"))
        or normalize_text(os.environ.get("DSPY_API_KEY"))
        or normalize_text(os.environ.get("MINIMAX_API_KEY"))
        or normalize_text(os.environ.get("OPENAI_API_KEY"))
    )
    api_base = (
        normalize_text(payload.get("apiBase"))
        or normalize_text(os.environ.get("DSPY_API_BASE"))
        or normalize_text(os.environ.get("MINIMAX_API_BASE"))
        or normalize_text(os.environ.get("OPENAI_BASE_URL"))
    )
    if not api_key:
        return fallback_optimize(payload, "缺少 DSPY_API_KEY/MINIMAX_API_KEY/OPENAI_API_KEY，无法启用 DSPy LM。")

    prompt = normalize_text(payload.get("prompt"))
    context_messages = normalize_list(payload.get("contextMessages"))
    constraints = normalize_list(payload.get("constraints"))
    task_type = normalize_text(payload.get("taskType")) or "general"
    language = normalize_language(payload.get("language"))

    context_text = "\n".join(context_messages[-8:]) if context_messages else ""
    constraints_text = "\n".join(constraints) if constraints else ""

    class RewritePrompt(dspy.Signature):
        """Rewrite into a higher-quality structured prompt.
        Always write outputs strictly in target_language.
        """

        task_type = dspy.InputField()
        prompt = dspy.InputField()
        context = dspy.InputField()
        constraints = dspy.InputField()
        target_language = dspy.InputField()
        optimized_prompt = dspy.OutputField()
        rationale = dspy.OutputField()

    try:
        base_candidates = build_api_base_candidates(api_base)
        last_error = ""

        for candidate in base_candidates:
            try:
                lm_kwargs = {
                    "model": model_name,
                    "api_key": api_key,
                }
                if candidate:
                    lm_kwargs["api_base"] = candidate
                    lm_kwargs["base_url"] = candidate

                lm = dspy.LM(**lm_kwargs)
                dspy.configure(lm=lm)
                optimizer = dspy.Predict(RewritePrompt)
                pred = optimizer(
                    task_type=task_type,
                    prompt=prompt,
                    context=context_text,
                    constraints=constraints_text,
                    target_language=language,
                )
                optimized_prompt = normalize_text(getattr(pred, "optimized_prompt", ""))
                rationale = normalize_text(getattr(pred, "rationale", ""))
                if not optimized_prompt:
                    last_error = f"empty output on base={candidate or 'default'}"
                    continue

                return {
                    "mode": "dspy",
                    "optimizedPrompt": optimized_prompt,
                    "changes": [
                        "DSPy 已按任务类型重写 Prompt 结构。",
                        "已融合上下文与约束，减少歧义。",
                        "保持目标不变并增强可执行性。",
                    ],
                    "rationale": [rationale or "DSPy 根据输入上下文和约束自动优化了提示词结构。"],
                    "meta": {
                        "dspyAvailable": True,
                        "model": model_name,
                        "apiBase": candidate or "",
                        "language": language,
                    },
                }
            except Exception as error:
                last_error = f"base={candidate or 'default'} -> {str(error)}"

        return fallback_optimize(
            payload,
            "DSPy 执行失败：无法从网关获取有效 JSON 响应。"
            + f" 已尝试 API Base: {', '.join([c or 'default' for c in base_candidates])}. 最后错误: {last_error}",
        )
    except Exception as error:
        return fallback_optimize(payload, f"DSPy 执行失败：{str(error)}")


def main() -> None:
    raw = sys.stdin.read() or "{}"
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {}

    prompt = normalize_text(payload.get("prompt"))
    if not prompt:
        print(json.dumps({"error": "prompt required"}, ensure_ascii=False))
        sys.exit(0)

    result = try_dspy_optimize(payload)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
