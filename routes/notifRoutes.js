const express = require("express");
const router = express.Router();
const Post = require("../models/PostModel");

const gh = require("../config/githubApi");

router.get("/currentUser", async (req, res, next) => {

  /** Retrieve liked and commented events concerning the user
   * 
   * @param {*} user 
   */
  async function getDbNotification(user) {
    const eventsResponse = await gh(user.access_token).get(
      `/users/${user.login}/events`
    );
    const ghEvents = eventsResponse.data;
    let notificationEvents = await Post.getNotifications(ghEvents);

    notificationEvents = notificationEvents.reduce((acc, event) => {
      let { comments, likes } = event;
      comments = comments.reverse();
      likes = likes.reverse();
      let result = [];
      if (comments.length > 0) {
        let commentEvent = {
          id: event.githubPost.id,
          type: "GitLinkComment",
          comments,
          githubPost: event.githubPost,
          created_at: new Date(
            Math.max(...comments.map(comm => comm.timestamp), 0)
          )
        };
        result = result.concat(commentEvent);
      }

      if (likes.length > 0) {
        let likeEvent = {
          id: event.githubPost.id,
          type: "GitLinkLike",
          likes,
          githubPost: event.githubPost,
          created_at: new Date(
            Math.max(...likes.map(comm => comm.timestamp), 0)
          )
        };
        result = result.concat(likeEvent);
      }
      return acc.concat(result);
    }, []);
    return notificationEvents;
  }

  /** Retrieve GitHub events concerning the user
   * 
   * @param {*} user 
   */
  async function getGhNotifications(user) {
    // Get current user's repos
    const reposResponse = await gh(user.access_token).get(
      `/users/${user.login}/repos?per_page=50&type=all`
    );

    // Get recently updated repos
    let userRepos = reposResponse.data.filter(repo => (new Date(repo.updated_at)) > new Date(new Date(new Date() - 3600*24*1000*2)));

    // Get events for each repo
    let reposEventsResponse = await Promise.all(
      userRepos.map(async repo => {
        let reposResponse = await gh(user.access_token).get(
          `/repos/${repo.owner.login}/${repo.name}/events?per_page=50`
        );
        return reposResponse;
      })
    );
    const repoEvents = reposEventsResponse.reduce(
      (acc, response) => acc.concat(...response.data),
      []
    ).map(oneEvent => {
      return {...oneEvent, created_at: new Date (oneEvent.created_at)};
    });

    return repoEvents;
  }

  try {
    const user = req.user;

    let [ghNotifications, dbNotifications] = await Promise.all([
      // EVENTS FROM GITHUB
      getGhNotifications(user),
      // EVENTS FROM GITLINK
      getDbNotification(user)
    ]);

    const notifications = dbNotifications
      .concat(ghNotifications)
      .sort((first, second) => (second.created_at > first.created_at ? 1 : -1));

    res.json(notifications);
  } catch (err) {
    console.log(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
