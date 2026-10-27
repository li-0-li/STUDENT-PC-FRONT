import request from '@/api/request'

/**
 * ★ 2026-10-27 成绩单（stu-pc）
 *
 * GET /api/v1/stu/grades
 *   → { overallPct, creditSum, courseCount, gradedCount, pendingSubmit, pendingGrade,
 *       courses:[{courseId,courseName,credit,taskTotal,submitted,graded,
 *                homework:{total,submitted,scored,avgPct},
 *                experiment:{...}, myPct, classPct, diff}] }
 */
export function myGrades() {
  return request.get('/api/v1/stu/grades')
}

/**
 * GET /api/v1/stu/grades/{courseId}
 *   → { courseId, items:[{itemType,itemId,title,weekNum,totalScore,myScore,myPct,classPct,gradedTime,status}] }
 */
export function gradeDetail(courseId) {
  return request.get(`/api/v1/stu/grades/${courseId}`)
}
