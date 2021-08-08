import { renderSvgAndSave, RenderSvgAndSaveJobDescription } from "./utils"

// The multiprocessing library needs to be able to find the function
// as a default export - so this file is just re-exporting the
// helper function we want to map
module.exports = async function runJob(
    jobDescription: RenderSvgAndSaveJobDescription
) {
    return renderSvgAndSave(jobDescription)
}
