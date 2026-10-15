/**
 * 学生端 · 我的任务（新 UI 侧栏③，stu-pc 模块自有接口）
 *
 * GET /api/v1/stu/tasks?taskType=homework|experiment
 * 作业（assignment）与实验报告（experiment_task）两源合并、按截止时间升序。
 * 返回（Result 信封解包后）：
 *   [{ taskType:'homework'|'experiment', taskRefId, courseId, courseName, title,
 *      weekNum, deadline, submitStatus(null=未提交/draft/submitted/graded/finished),
 *      score }]
 */
import request from '../request'

/** 我的任务流；taskType 不传 = 全部 */
export function myTasks(taskType) {
  return request.get('/api/v1/stu/tasks', { params: taskType ? { taskType } : {} })
}
