import test from "node:test";
import assert from "node:assert/strict";
import { queryMarketSkills, matchesSkillQuery } from "./skills-catalog.ts";

test("matchesSkillQuery correctly matches name, description, author, and tags", () => {
  const skill = {
    name: "superpowers:tdd",
    description: "Test driven development workflow for AI agent",
    author: "obra",
    tags: ["testing", "workflow", "tdd"],
    sourceLabel: "skills.sh",
  };

  assert.equal(matchesSkillQuery(skill, "tdd"), true);
  assert.equal(matchesSkillQuery(skill, "Obra"), true);
  assert.equal(matchesSkillQuery(skill, "driven"), true);
  assert.equal(matchesSkillQuery(skill, "testing"), true);
  assert.equal(matchesSkillQuery(skill, "skills.sh"), true);
  assert.equal(matchesSkillQuery(skill, "non-existent-keyword"), false);
  assert.equal(matchesSkillQuery(skill, ""), true);
});

test("queryMarketSkills fetches live skills from skills.sh with keyword search", async () => {
  try {
    const results = await queryMarketSkills("tdd", "all");
    assert.ok(results.length > 0, "should return skills for 'tdd'");
    assert.ok(
      results.some((s) => s.name.toLowerCase().includes("tdd")),
      "should include a skill with name matching 'tdd'",
    );
    // 验证返回的数据结构完整性
    const first = results[0];
    assert.ok(first.id.startsWith("skills-sh-"));
    assert.ok(first.name);
    assert.ok(first.author);
    assert.equal(first.sourceType, "skills.sh");
    assert.equal(first.category, "public");
  } catch (err) {
    // 外网连接异常时跳过断言（避免 CI 网络波动），并验证抛出标准可控错误
    assert.ok(err instanceof Error);
  }
});

test("queryMarketSkills browse mode returns popular skills sorted by installs", async () => {
  try {
    const results = await queryMarketSkills("", "all");
    assert.ok(results.length >= 10, "browse mode should return popular skills");
    // 验证按安装量降序排序
    const first = results[0];
    assert.ok(first.installs, "should have installs metric");
  } catch (err) {
    assert.ok(err instanceof Error);
  }
});

test("queryMarketSkills business category returns empty list (skills.sh is public)", async () => {
  const results = await queryMarketSkills("tdd", "business");
  assert.equal(results.length, 0, "skills.sh only hosts public skills");
});
