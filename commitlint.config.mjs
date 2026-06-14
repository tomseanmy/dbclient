export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat', // 新功能
        'fix', // 修复
        'docs', // 文档
        'style', // 格式（不影响逻辑）
        'refactor', // 重构
        'perf', // 性能
        'test', // 测试
        'build', // 构建/依赖
        'ci', // CI
        'chore', // 杂务
        'revert', // 回滚
      ],
    ],
    'subject-case': [0], // 不限制 subject 大小写（中英文混用）
  },
}
