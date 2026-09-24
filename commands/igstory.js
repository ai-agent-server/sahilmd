import requests
def get_stories(username):
    return (
        requests.post(
            "https://storyviewer.com/api/v1/web/profile",
            json={
                "username": username,
                "user_info": True,
                "user_stories": True,
                "user_highlights": True,
                "user_posts": True,
            },
        )
        .json()
        .get("stories", [])
    )
print(get_stories("realmadrid"))
